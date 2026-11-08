import { useEffect, useMemo, type RefObject } from 'react';

import { paintHighlights, type HighlightRequest } from '@/modules/review/selection/highlightRanges';
import { useReview } from '@/modules/review/state/ReviewContext';

const REPAINT_DEBOUNCE_MS = 200;
const NO_REQUESTS: HighlightRequest[] = [];

/** Repaints when marks change and when transcript rows mount or re-render. */
export default function ReviewHighlights({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
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
    // Read inside the effect: the ref is set by the time effects run, unlike during render.
    const container = containerRef.current;
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
  }, [containerRef, discussed, drafts]);

  // Unmount only, so repaints never clear and flash the highlights.
  useEffect(() => () => {
    const registry = typeof CSS === 'undefined'
      ? undefined
      : (CSS as unknown as { highlights?: { delete(name: string): void } }).highlights;
    registry?.delete('review-draft');
    registry?.delete('review-discussed');
  }, []);

  return null;
}
