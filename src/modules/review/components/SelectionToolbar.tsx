import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveSelection, type ResolvedSelection } from '@/modules/review/selection/resolveSelection';
import { useReview } from '@/modules/review/state/ReviewContext';
import type { MarkKind } from '@/modules/review/types';

type Anchored = { selection: ResolvedSelection; range: Range };

const TOOLBAR_OFFSET = 44;
const EDGE = 8;
const TOOLBAR_WIDTH = 208;
const TOOLBAR_HEIGHT = 36;
const POPOVER_WIDTH = 288;
const POPOVER_HEIGHT = 140;

function readAnchored(): Anchored | null {
  const domSelection = window.getSelection();
  const selection = resolveSelection(domSelection);
  if (!selection || !domSelection) {
    return null;
  }
  return { selection, range: domSelection.getRangeAt(0).cloneRange() };
}

/** Fixed position for an element beside the range, kept inside the viewport. */
function place(range: Range, width: number, height: number) {
  const rect = range.getBoundingClientRect();
  // Touch devices draw their own menu above a selection, so go below it there.
  const below = window.matchMedia('(pointer: coarse)').matches;
  let top = below ? rect.bottom + 12 : rect.top - TOOLBAR_OFFSET;
  if (top + height > window.innerHeight - EDGE) {
    // No room below: flip above the selection.
    top = rect.top - height - 4;
  }
  return {
    top: Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE)),
    left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE)),
  };
}

/** Mounted once by ChatInterface; floats over any selection in an assistant message. */
export default function SelectionToolbar() {
  const { t } = useTranslation('chat');
  const review = useReview();
  const [anchored, setAnchored] = useState<Anchored | null>(null);
  // While a note is being written the selection is gone (the textarea took
  // focus), so the popover holds its own copy.
  const [composing, setComposing] = useState<(Anchored & { kind: MarkKind }) | null>(null);
  const [note, setNote] = useState('');
  // Scrolling or resizing moves the passage; this re-renders to re-anchor.
  const [, setLayoutTick] = useState(0);

  useEffect(() => {
    const onSelectionChange = () => setAnchored(readAnchored());
    document.addEventListener('selectionchange', onSelectionChange);
    const onLayout = () => setLayoutTick((tick) => tick + 1);
    window.addEventListener('scroll', onLayout, true);
    window.addEventListener('resize', onLayout);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', onLayout, true);
      window.removeEventListener('resize', onLayout);
    };
  }, []);

  if (!review) {
    return null;
  }

  const closePopover = () => {
    setComposing(null);
    setNote('');
  };

  const addRedline = () => {
    if (anchored) {
      review.addMark({ kind: 'redline', ...anchored.selection, note: '' });
      window.getSelection()?.removeAllRanges();
      setAnchored(null);
    }
  };

  const submitNote = () => {
    if (composing && note.trim()) {
      review.addMark({ kind: composing.kind, ...composing.selection, note: note.trim() });
      closePopover();
      window.getSelection()?.removeAllRanges();
    }
  };

  if (composing) {
    const position = place(composing.range, POPOVER_WIDTH, POPOVER_HEIGHT);
    return (
      <div
        role="dialog"
        aria-label={composing.kind === 'question'
          ? t('review.askDialog', 'Ask about this passage')
          : t('review.commentDialog', 'Comment on this passage')}
        className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg"
        style={{ top: position.top, left: position.left }}
      >
        <textarea
          autoFocus
          data-testid="review-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-label={composing.kind === 'question'
            ? t('review.askPlaceholder', 'Ask about this…')
            : t('review.commentPlaceholder', 'Add a comment…')}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closePopover();
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submitNote();
            }
          }}
          rows={3}
          placeholder={composing.kind === 'question'
            ? t('review.askPlaceholder', 'Ask about this…')
            : t('review.commentPlaceholder', 'Add a comment…')}
          className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm"
        />
        <div className="mt-1 flex justify-end gap-1 text-xs">
          <button type="button" onClick={closePopover} className="rounded-md px-2 py-1 hover:bg-accent">
            {t('review.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            data-testid="review-note-add"
            onClick={submitNote}
            className="rounded-md bg-primary px-2 py-1 text-primary-foreground"
          >
            {t('review.add', 'Add')}
          </button>
        </div>
      </div>
    );
  }

  if (!anchored) {
    return null;
  }

  const position = place(anchored.range, TOOLBAR_WIDTH, TOOLBAR_HEIGHT);
  const buttonClass = 'rounded-md px-2 py-1 hover:bg-accent';
  return (
    <div
      // Keeps the click from collapsing the selection before it is read.
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 flex gap-0.5 rounded-lg border border-border bg-popover p-1 text-xs shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      <button type="button" data-testid="review-comment" className={buttonClass} onClick={() => setComposing({ ...anchored, kind: 'comment' })}>
        {t('review.comment', 'Comment')}
      </button>
      <button type="button" data-testid="review-ask" className={buttonClass} onClick={() => setComposing({ ...anchored, kind: 'question' })}>
        {t('review.ask', 'Ask')}
      </button>
      <button type="button" data-testid="review-redline" className={buttonClass} onClick={addRedline}>
        {t('review.redline', 'Redline')}
      </button>
    </div>
  );
}
