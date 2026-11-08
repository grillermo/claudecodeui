import assert from 'node:assert/strict';

import { fireEvent, render, screen } from '@testing-library/react';
import { test } from 'vitest';

import ReviewSegments from '@/modules/review/components/ReviewSegments';
import { hashText } from '@/modules/review/parsing/hashText';
import { buildReviewIndex } from '@/modules/review/state/buildReviewIndex';
import { ReviewContext, type ReviewContextValue } from '@/modules/review/state/ReviewContext';
import type { ChatMessage } from '@/shared/types';

const assistant = (content: string) => ({ type: 'assistant', content, timestamp: 0 }) as ChatMessage;
const renderMarkdown = (markdown: string) => <div data-testid="md">{markdown}</div>;

const v1 = ':::doc id=a title="Plan"\nStore files locally today\n:::';
const v2 = ':::doc id=a title="Plan" addresses=m1\nStore files remotely today\n:::';
const context = (messages: ChatMessage[]): ReviewContextValue => ({
  index: buildReviewIndex(messages),
  marks: [],
  saveFailed: false,
  addMark: () => {},
  updateMark: () => {},
  removeMark: () => {},
  composeFeedback: (typed) => typed,
  clearMarks: () => {},
});

const show = (content: string, messages: ChatMessage[], isStreaming = false) => render(
  <ReviewContext.Provider value={context(messages)}>
    <ReviewSegments
      content={content}
      messageHash={hashText(content)}
      isStreaming={isStreaming}
      renderMarkdown={renderMarkdown}
    />
  </ReviewContext.Provider>,
);

test('v1 is a plain card carrying its target', () => {
  const { container } = show(v1, [assistant(v1)]);
  assert.ok(container.querySelector('[data-review-target="a@v1"]'));
  assert.equal(screen.queryByTestId('review-toggle-changes'), null);
  assert.equal(screen.getByTestId('md').textContent, 'Store files locally today');
});

test('v2 marks changes and can hide them', () => {
  const { container } = show(v2, [assistant(v1), assistant(v2)]);
  assert.ok(container.querySelector('[data-review-target="a@v2"]'));
  assert.equal(screen.getByTestId('review-change-count').dataset.changeCount, '1');
  assert.ok(screen.getByTestId('md').textContent?.includes('remotely'));
  fireEvent.click(screen.getByTestId('review-toggle-changes'));
  assert.equal(screen.getByTestId('md').textContent, 'Store files remotely today');
});

test('a version whose predecessor is gone renders as a first version', () => {
  show(v2, [assistant(v2)]);
  assert.equal(screen.queryByTestId('review-toggle-changes'), null);
});

test('an open doc has no target or diff', () => {
  const open = ':::doc id=a\npartial';
  const { container } = show(open, [assistant(v1)], true);
  assert.equal(container.querySelector('[data-review-target]'), null);
  assert.equal(screen.getByTestId('md').textContent, 'partial');
});

test('feedback renders quote cards and flags a lost passage', () => {
  const feedback = ':::feedback\n[m1 comment a@v1] "Store files"\nnote\n\n[m2 redline a@v1] "not there"\n:::';
  const { container } = show(feedback, [assistant(v1)]);
  assert.ok(container.querySelector('#review-mark-m1'));
  assert.equal(screen.queryByTestId('review-mark-lost-m1'), null);
  assert.ok(screen.getByTestId('review-mark-lost-m2'));
});

test('malformed blocks render as markdown with a note and nothing throws', () => {
  show(':::doc title="no id"\nbody\n:::', []);
  assert.ok(screen.getByTestId('review-malformed'));
  assert.ok(screen.getByTestId('md').textContent?.includes('no id'));
});
