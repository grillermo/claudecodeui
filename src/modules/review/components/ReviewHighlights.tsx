import { useEffect, useMemo } from 'react';

import { paintHighlights, type HighlightRequest } from '@/modules/review/selection/highlightRanges';
import { useReview } from '@/modules/review/state/ReviewContext';

const REPAINT_DEBOUNCE_MS = 200;
const NO_REQUESTS: HighlightRequest[] = [];

/** Repaints when marks change and when transcript rows mount or re-render. */
export default function ReviewHighlights({ container }: { container: HTMLElement | null }) {
  const review = useReview();
  const drafts: HighlightRequest[] = review?.marks ?? NO_REQUESTS;
  const discussed = useMemo<HighlightRequest[]>(() => {
    const requests: HighlightRequest[] = [];
    review?.index.discussions.forEach((list, target) => {
      list.forEach(({ quote }) => requests.push({ target, quote }));
    });
    return requests;
  }, [review?.index]);

  useEffect(() => {
    paintHighlights(drafts, discussed);
    if (!container) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => paintHighlights(drafts, discussed), REPAINT_DEBOUNCE_MS);
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [container, discussed, drafts]);

  return null;
}
