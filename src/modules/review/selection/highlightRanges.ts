import type { MarkAnchor } from '@/modules/review/types';

export type HighlightRequest = MarkAnchor & { target: string };

type CharacterPosition = { node: Text; offset: number };

/** Every non-whitespace character in `root`, with where it lives in the DOM. */
function indexCharacters(root: HTMLElement): { text: string; positions: CharacterPosition[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (
      node.parentElement?.closest('del, [data-review-chrome]')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT
    ),
  });
  let text = '';
  const positions: CharacterPosition[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let offset = 0; offset < node.data.length; offset++) {
      if (!/\s/.test(node.data[offset])) {
        text += node.data[offset];
        positions.push({ node, offset });
      }
    }
  }
  return { text, positions };
}

const squash = (text: string) => text.replace(/\s+/g, '');

/** A DOM range over the quote in `root`, using context to choose among repeats. */
export function findQuoteRange(root: HTMLElement, anchor: MarkAnchor): Range | null {
  const { text, positions } = indexCharacters(root);
  const quote = squash(anchor.quote);
  if (!quote) {
    return null;
  }
  const before = squash(anchor.before ?? '');
  const after = squash(anchor.after ?? '');

  let chosen = -1;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    if (chosen === -1) {
      chosen = at;
    }
    if ((before || after)
      && (!before || text.slice(0, at).endsWith(before))
      && (!after || text.slice(at + quote.length).startsWith(after))) {
      chosen = at;
      break;
    }
  }
  if (chosen === -1) {
    return null;
  }

  const start = positions[chosen];
  const end = positions[chosen + quote.length - 1];
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

const escapeAttribute = (value: string) => (
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\\]]/g, '\\$&')
);

function rangesFor(requests: HighlightRequest[]): Range[] {
  const ranges: Range[] = [];
  for (const request of requests) {
    const root = document.querySelector<HTMLElement>(`[data-review-target="${escapeAttribute(request.target)}"]`);
    const range = root ? findQuoteRange(root, request) : null;
    if (range) {
      ranges.push(range);
    }
  }
  return ranges;
}

/** Paints draft and discussed passages without touching the rendered DOM. */
export function paintHighlights(drafts: HighlightRequest[], discussed: HighlightRequest[]): void {
  const registry = typeof CSS === 'undefined'
    ? undefined
    : (CSS as unknown as { highlights?: { set(name: string, value: unknown): void } }).highlights;
  const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightClass) {
    return;
  }
  registry.set('review-draft', new HighlightClass(...rangesFor(drafts)));
  registry.set('review-discussed', new HighlightClass(...rangesFor(discussed)));
}
