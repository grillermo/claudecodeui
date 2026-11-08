import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useReviewSession } from '@/modules/review/state/useReviewSession';
import type { ChatMessage } from '@/shared/types';

const store = vi.hoisted(() => ({
  marks: new Map<string, unknown[]>(),
  // One array: useSyncExternalStore needs a stable snapshot, as the real store gives.
  noMarks: [] as unknown[],
  queued: null as { content: string } | null,
  listeners: new Set<() => void>(),
}));

vi.mock('@/shared/chatDrafts', () => ({
  readDraftMarks: (scope: string) => store.marks.get(scope) ?? store.noMarks,
  writeDraftMarks: (scope: string, marks: unknown[]) => {
    store.marks.set(scope, marks);
    store.listeners.forEach((listener) => listener());
  },
  didDraftMarksSaveFail: () => false,
  readQueuedMessage: () => store.queued,
  subscribeToChatDrafts: (listener: () => void) => {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
}));

const NEW_MARK = { kind: 'comment' as const, target: 'a@v1', quote: 'q', note: 'fix' };
const user = (content: string) => ({ type: 'user', content, timestamp: 0 }) as ChatMessage;

beforeEach(() => {
  store.marks.clear();
  store.queued = null;
});

const session = (messages: ChatMessage[] = []) => renderHook(() => useReviewSession(messages, 's1')).result;

test('marks persist through the draft store', () => {
  const result = session();
  act(() => result.current.addMark(NEW_MARK));
  assert.equal(result.current.marks.length, 1);
  assert.equal((store.marks.get('s1') as any[]).length, 1);
  const { key } = result.current.marks[0];
  act(() => result.current.updateMark(key, 'edited'));
  assert.equal(result.current.marks[0].note, 'edited');
  act(() => result.current.removeMark(key));
  assert.equal(result.current.marks.length, 0);
});

test('composes the exact block ahead of the typed text', () => {
  const result = session();
  act(() => result.current.addMark(NEW_MARK));
  assert.equal(
    result.current.composeFeedback('and also this'),
    ':::feedback\n[m1 comment a@v1] "q"\nfix\n:::\nand also this',
  );
});

test('numbers after the transcript and after a queued round', () => {
  const sent = user(':::feedback\n[m3 comment a@v1] "q"\n:::');
  store.queued = { content: ':::feedback\n[m7 comment a@v1] "q"\n:::' };
  const result = session([sent]);
  act(() => result.current.addMark(NEW_MARK));
  assert.ok(result.current.composeFeedback('').includes('[m8 comment'));
});

test('with no marks the text passes through', () => {
  assert.equal(session().current.composeFeedback('hello'), 'hello');
});

test('clearMarks empties the tray', () => {
  const result = session();
  act(() => result.current.addMark(NEW_MARK));
  act(() => result.current.clearMarks());
  assert.deepEqual(result.current.marks, []);
});
