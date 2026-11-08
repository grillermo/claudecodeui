import { useTranslation } from 'react-i18next';

import { useReview } from '@/modules/review/state/ReviewContext';
import type { FeedbackMark, MarkKind } from '@/modules/review/types';

const KIND_STYLES: Record<MarkKind, string> = {
  comment: 'border-l-blue-500',
  question: 'border-l-violet-500',
  redline: 'border-l-red-500',
};

export function scrollToReviewElement(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function scrollToTarget(target: string): void {
  document
    .querySelector(`[data-review-target="${CSS.escape(target)}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export default function FeedbackRound({ marks }: { marks: FeedbackMark[] }) {
  const { t } = useTranslation('chat');
  const review = useReview();

  return (
    <div className="not-prose my-1 flex flex-col gap-2 text-left font-sans">
      {marks.map((mark) => {
        const lost = review !== null && !review.index.hasPassage(mark.target, mark.quote);
        return (
          <div
            key={mark.id}
            id={`review-mark-${mark.id}`}
            className={`rounded-md border-l-2 bg-background/60 px-3 py-2 text-xs ${KIND_STYLES[mark.kind]}`}
          >
            <button
              type="button"
              disabled={lost}
              onClick={() => scrollToTarget(mark.target)}
              className="block w-full text-left italic text-muted-foreground enabled:hover:text-foreground"
            >
              <span className="mr-1 font-mono not-italic">{mark.id} · {t(`review.kind.${mark.kind}`, mark.kind)}</span>
              “{mark.quote}”
            </button>
            {mark.note && <div className="mt-1 whitespace-pre-wrap text-sm text-foreground">{mark.note}</div>}
            {lost && (
              <div data-testid={`review-mark-lost-${mark.id}`} className="mt-1 text-muted-foreground">
                {t('review.passageLost', 'Passage no longer in the conversation')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
