import type { MarkAnchor } from '@/modules/review/types';

export type ResolvedSelection = MarkAnchor & { target: string };

const CONTEXT_CHARACTERS = 24;
const EXCLUDED = 'del, [data-review-chrome]';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const squash = (text: string) => text.replace(/\s+/g, '');

const closestTarget = (node: Node | null): HTMLElement | null => {
  const element = node instanceof Element ? node : node?.parentElement ?? null;
  return element?.closest<HTMLElement>('[data-review-target]') ?? null;
};

/** Text in a range, leaving out deleted text and card chrome. */
function rangeText(range: Range): string {
  const fragment = range.cloneContents();
  const hadExcluded = fragment.querySelector(EXCLUDED) !== null;
  fragment.querySelectorAll(EXCLUDED).forEach((element) => element.remove());
  return hadExcluded ? fragment.textContent ?? '' : range.toString();
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    count += 1;
  }
  return count;
}

/** Turns the browser selection into a mark's target and anchor, or null if it can't be marked. */
export function resolveSelection(selection: Selection | null): ResolvedSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const target = closestTarget(range.startContainer);
  if (!target || target !== closestTarget(range.endContainer)) {
    return null;
  }
  const targetId = target.dataset.reviewTarget;
  const quote = oneLine(rangeText(range));
  if (!targetId || !quote) {
    return null;
  }

  const whole = document.createRange();
  whole.selectNodeContents(target);
  if (countOccurrences(squash(rangeText(whole)), squash(quote)) <= 1) {
    return { target: targetId, quote };
  }

  const beforeRange = whole.cloneRange();
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const afterRange = whole.cloneRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  const before = oneLine(oneLine(rangeText(beforeRange)).slice(-CONTEXT_CHARACTERS));
  const after = oneLine(oneLine(rangeText(afterRange)).slice(0, CONTEXT_CHARACTERS));
  return {
    target: targetId,
    quote,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}
