import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveSelection, type ResolvedSelection } from '@/modules/review/selection/resolveSelection';
import { useReview } from '@/modules/review/state/ReviewContext';
import type { MarkKind } from '@/modules/review/types';

type Anchored = { selection: ResolvedSelection; top: number; left: number };

const TOOLBAR_OFFSET = 44;

function readAnchored(): Anchored | null {
  const domSelection = window.getSelection();
  const selection = resolveSelection(domSelection);
  if (!selection || !domSelection) {
    return null;
  }
  const rect = domSelection.getRangeAt(0).getBoundingClientRect();
  // Touch devices draw their own menu above a selection, so go below it there.
  const below = window.matchMedia('(pointer: coarse)').matches;
  return {
    selection,
    top: below ? rect.bottom + 12 : Math.max(8, rect.top - TOOLBAR_OFFSET),
    left: Math.max(8, rect.left),
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

  useEffect(() => {
    const onSelectionChange = () => setAnchored(readAnchored());
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
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
    return (
      <div
        className="fixed z-50 w-72 rounded-lg border border-border bg-popover p-2 shadow-lg"
        style={{ top: composing.top, left: composing.left }}
      >
        <textarea
          autoFocus
          data-testid="review-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
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

  const buttonClass = 'rounded-md px-2 py-1 hover:bg-accent';
  return (
    <div
      // Keeps the click from collapsing the selection before it is read.
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 flex gap-0.5 rounded-lg border border-border bg-popover p-1 text-xs shadow-lg"
      style={{ top: anchored.top, left: anchored.left }}
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
