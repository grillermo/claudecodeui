import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import SelectionToolbar from '@/modules/review/components/SelectionToolbar';
import { resolveSelection } from '@/modules/review/selection/resolveSelection';
import { EMPTY_REVIEW_INDEX } from '@/modules/review/state/buildReviewIndex';
import { ReviewContext, type ReviewContextValue } from '@/modules/review/state/ReviewContext';

Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Selection {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

test('resolves the quote and the nearest target', () => {
  const host = mount('<div data-review-target="msg:1"><div data-review-target="a@v2"><p>hello big world</p></div></div>');
  const text = host.querySelector('p')!.firstChild!;
  assert.deepEqual(resolveSelection(select(text, 6, text, 9)), { target: 'a@v2', quote: 'big' });
});

test('adds context only for an ambiguous quote', () => {
  const host = mount('<div data-review-target="msg:1"><p>one word then another word again</p></div>');
  const text = host.querySelector('p')!.firstChild!;
  assert.deepEqual(resolveSelection(select(text, 22, text, 26)), {
    target: 'msg:1',
    quote: 'word',
    before: 'one word then another',
    after: 'again',
  });
});

test('refuses selections outside a target, across targets, or collapsed', () => {
  const host = mount('<p id="o">outside</p><div data-review-target="a@v1"><p id="a">aaa</p></div><div data-review-target="b@v1"><p id="b">bbb</p></div>');
  const textOf = (id: string) => host.querySelector(`#${id}`)!.firstChild!;
  assert.equal(resolveSelection(select(textOf('o'), 0, textOf('o'), 3)), null);
  assert.equal(resolveSelection(select(textOf('a'), 0, textOf('b'), 1)), null);
  assert.equal(resolveSelection(select(textOf('a'), 1, textOf('a'), 1)), null);
});

test('deleted text and card chrome are not part of the quote', () => {
  const host = mount('<div data-review-target="a@v2"><div data-review-chrome>v2</div><p>keep <del>gone </del>more</p></div>');
  const paragraph = host.querySelector('p')!;
  assert.deepEqual(resolveSelection(select(paragraph.firstChild!, 0, paragraph.lastChild!, 4)), {
    target: 'a@v2',
    quote: 'keep more',
  });
});

test('toolbar: redline adds at once, comment opens a popover', async () => {
  const addMark = vi.fn();
  const value = { index: EMPTY_REVIEW_INDEX, marks: [], addMark } as unknown as ReviewContextValue;
  const host = mount('<div data-review-target="a@v1"><p>hello world</p></div>');
  render(<ReviewContext.Provider value={value}><SelectionToolbar /></ReviewContext.Provider>);
  const text = host.querySelector('p')!.firstChild!;

  select(text, 0, text, 5);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(await screen.findByTestId('review-redline'));
  assert.deepEqual(addMark.mock.calls[0][0], { kind: 'redline', target: 'a@v1', quote: 'hello', note: '' });

  select(text, 6, text, 11);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(await screen.findByTestId('review-comment'));
  fireEvent.change(screen.getByTestId('review-note'), { target: { value: 'why' } });
  fireEvent.click(screen.getByTestId('review-note-add'));
  assert.deepEqual(addMark.mock.calls[1][0], { kind: 'comment', target: 'a@v1', quote: 'world', note: 'why' });
});

async function openComment(addMark = vi.fn()) {
  const value = { index: EMPTY_REVIEW_INDEX, marks: [], addMark } as unknown as ReviewContextValue;
  const host = mount('<div data-review-target="a@v1"><p>hello world</p></div>');
  render(<ReviewContext.Provider value={value}><SelectionToolbar /></ReviewContext.Provider>);
  const text = host.querySelector('p')!.firstChild!;
  select(text, 0, text, 5);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(await screen.findByTestId('review-comment'));
  return addMark;
}

test('popover: Escape cancels, Ctrl+Enter submits', async () => {
  const addMark = await openComment();
  assert.ok(screen.getByRole('dialog'));
  fireEvent.change(screen.getByTestId('review-note'), { target: { value: 'x' } });
  fireEvent.keyDown(screen.getByTestId('review-note'), { key: 'Escape' });
  assert.equal(screen.queryByTestId('review-note'), null);
  assert.equal(addMark.mock.calls.length, 0);
});

test('popover: Ctrl+Enter submits the note', async () => {
  const addMark = await openComment();
  fireEvent.change(screen.getByTestId('review-note'), { target: { value: 'why' } });
  fireEvent.keyDown(screen.getByTestId('review-note'), { key: 'Enter', ctrlKey: true });
  assert.equal(addMark.mock.calls[0][0].note, 'why');
});

test('popover stays inside the viewport', async () => {
  const original = Range.prototype.getBoundingClientRect;
  Range.prototype.getBoundingClientRect = () => ({ top: 5000, left: 5000, bottom: 5010, right: 5100, width: 100, height: 10, x: 5000, y: 5000, toJSON: () => ({}) });
  try {
    await openComment();
    const style = screen.getByRole('dialog').style;
    assert.ok(parseFloat(style.left) <= window.innerWidth - 288 - 8);
    assert.ok(parseFloat(style.top) <= window.innerHeight - 8);
  } finally {
    Range.prototype.getBoundingClientRect = original;
  }
});
