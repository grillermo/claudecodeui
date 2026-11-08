import { useTranslation } from 'react-i18next';

import { scrollToReviewElement } from '@/modules/review/components/FeedbackRound';
import { useReview } from '@/modules/review/state/ReviewContext';

/** Under a message or document: one chip per passage discussed later. */
export default function PassageBadges({ target }: { target: string }) {
  const { t } = useTranslation('chat');
  const discussions = useReview()?.index.discussions.get(target);
  if (!discussions?.length) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 font-sans text-xs">
      {discussions.map((discussion) => (
        <button
          key={discussion.quote}
          type="button"
          onClick={() => scrollToReviewElement(`review-mark-${discussion.markIds[0]}`)}
          className="max-w-xs truncate rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:bg-accent"
        >
          “{discussion.quote}” ·{' '}
          {t('review.discussions', { count: discussion.markIds.length, defaultValue: '{{count}} discussions' })}
        </button>
      ))}
    </div>
  );
}
