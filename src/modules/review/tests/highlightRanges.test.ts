import assert from 'node:assert/strict';
import { afterEach, test } from 'vitest';

import { findQuoteRange, paintHighlights } from '@/modules/review/selection/highlightRanges';

afterEach(() => {
  document.body.innerHTML = '';
  delete (globalThis as any).Highlight;
  delete (CSS as any).highlights;
});

const mount = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
};

test('finds a quote across inline elements', () => {
  const target = mount('<div><p>keep <strong>bold</strong> words</p></div>');
  assert.equal(findQuoteRange(target, { quote: 'keep bold words' })?.toString(), 'keep bold words');
});

test('uses context to pick the right occurrence', () => {
  const target = mount('<div><p>one word then another word again</p></div>');
  const range = findQuoteRange(target, { quote: 'word', before: 'another', after: 'again' });
  assert.equal(range?.startOffset, 22);
});

test('returns null when the quote is gone', () => {
  assert.equal(findQuoteRange(mount('<div><p>text</p></div>'), { quote: 'missing' }), null);
});

test('is a no-op without API support', () => {
  mount('<div data-review-target="a@v1"><p>text</p></div>');
  assert.doesNotThrow(() => paintHighlights([{ target: 'a@v1', quote: 'text' }], []));
});

test('registers both highlight groups', () => {
  const registry = new Map<string, unknown[]>();
  (CSS as any).highlights = { set: (name: string, value: unknown[]) => registry.set(name, value), delete: (name: string) => registry.delete(name) };
  (globalThis as any).Highlight = class extends Array { constructor(...ranges: unknown[]) { super(); this.push(...ranges); } };
  mount('<div data-review-target="a@v1"><p>draft passage and discussed passage</p></div>');
  paintHighlights([{ target: 'a@v1', quote: 'draft' }], [{ target: 'a@v1', quote: 'discussed' }]);
  assert.equal((registry.get('review-draft') as unknown[]).length, 1);
  assert.equal((registry.get('review-discussed') as unknown[]).length, 1);
});

test('skips text inside <del> and review chrome', () => {
  const target = mount('<div><p>keep <del>struck</del><span data-review-chrome>badge</span> visible</p></div>');
  assert.equal(findQuoteRange(target, { quote: 'struck' }), null);
  assert.equal(findQuoteRange(target, { quote: 'badge' }), null);
  assert.equal(findQuoteRange(target, { quote: 'visible' })?.toString(), 'visible');
});
