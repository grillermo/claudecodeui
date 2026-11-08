import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useReview } from '@/modules/review/state/ReviewContext';

/** Above the composer: everything that will go with the next message. */
export default function MarksTray() {
  const { t } = useTranslation('chat');
  const review = useReview();
  if (!review || review.marks.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto mb-2 flex max-h-48 max-w-[54.25rem] flex-col gap-1.5 overflow-y-auto rounded-xl border border-border bg-muted/40 p-2 text-xs">
      {review.marks.map((mark) => (
        <div key={mark.key} className="flex items-start gap-2 rounded-md bg-background/70 p-2">
          <div className="min-w-0 flex-1">
            <div className="truncate italic text-muted-foreground">
              <span className="mr-1 font-mono not-italic">{t(`review.kind.${mark.kind}`, mark.kind)}</span>
              “{mark.quote}”
            </div>
            {mark.kind !== 'redline' && (
              <textarea
                data-testid={`review-tray-note-${mark.key}`}
                value={mark.note}
                rows={1}
                onChange={(event) => review.updateMark(mark.key, event.target.value)}
                className="mt-1 w-full resize-none rounded border border-border bg-background px-1.5 py-1 text-sm"
              />
            )}
          </div>
          <button
            type="button"
            data-testid={`review-tray-remove-${mark.key}`}
            aria-label={t('review.remove', 'Remove')}
            onClick={() => review.removeMark(mark.key)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {review.saveFailed && (
        <div data-testid="review-tray-save-failed" className="px-1 text-amber-600 dark:text-amber-400">
          {t('review.marksSaveFailed', "Couldn't save these marks. They'll be lost if you reload.")}
        </div>
      )}
    </div>
  );
}
