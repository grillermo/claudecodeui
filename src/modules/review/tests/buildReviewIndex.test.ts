import assert from 'node:assert/strict';
import { test } from 'vitest';

import { buildReviewIndex, reviewFingerprint } from '@/modules/review/state/buildReviewIndex';
import { hashText, messageTarget } from '@/modules/review/parsing/hashText';
import type { ChatMessage } from '@/shared/types';

const assistant = (content: string, extra: Partial<ChatMessage> = {}) =>
  ({ type: 'assistant', content, timestamp: 0, ...extra }) as ChatMessage;
const user = (content: string) => ({ type: 'user', content, timestamp: 0 }) as ChatMessage;
const plan = (toolId: string, text: string, toolResult?: unknown) => ({
  type: 'assistant', content: '', timestamp: 0, isToolUse: true,
  toolName: 'ExitPlanMode', toolId, toolInput: JSON.stringify({ plan: text }), toolResult,
}) as ChatMessage;
const doc = (id: string, body: string, attrs = '') => `:::doc id=${id}${attrs}\n${body}\n:::`;

test('later blocks with the same id are the next versions', () => {
  const first = doc('a', 'one');
  const second = doc('a', 'two', ' addresses=m1');
  const index = buildReviewIndex([assistant(first), user('hm'), assistant(second)]);
  assert.deepEqual(index.versions.get('a')?.map((v) => [v.version, v.body]), [[1, 'one'], [2, 'two']]);
  const located = index.docAt(hashText(second), 0);
  assert.equal(located?.version, 2);
  assert.equal(located?.previousBody, 'one');
  assert.equal(index.docAt(hashText(first), 0)?.previousBody, null);
});

test('blocks in user messages and streaming messages are not versions', () => {
  const index = buildReviewIndex([user(doc('a', 'u')), assistant(doc('a', 's'), { isStreaming: true })]);
  assert.equal(index.versions.size, 0);
});

test('ExitPlanMode plans are versions of the reserved id', () => {
  const index = buildReviewIndex([plan('t1', 'first'), plan('t2', 'second')]);
  assert.deepEqual(index.versions.get('plan')?.map((v) => v.version), [1, 2]);
  assert.equal(index.planAt('t2')?.previousBody, 'first');
  assert.equal(index.planAt('t2')?.version, 2);
});

test('the mark counter follows user messages and denied plans', () => {
  const round = (n: number) => `:::feedback\n[m${n} comment a@v1] "q"\n:::`;
  assert.equal(buildReviewIndex([]).nextMarkNumber, 1);
  assert.equal(buildReviewIndex([user(round(4))]).nextMarkNumber, 5);
  const denied = plan('t1', 'p', { isError: true, content: `prefix\n${round(9)}` });
  assert.equal(buildReviewIndex([user(round(4)), denied]).nextMarkNumber, 10);
});

test('discussions point at marks whose passage still exists', () => {
  const body = 'Keep **bold words** here';
  const source = assistant(doc('a', body));
  const prose = assistant('A reply');
  const target = messageTarget('A reply');
  const feedback = user(
    `:::feedback\n[m1 comment a@v1] "bold words"\nwhy\n\n[m2 question a@v1] "bold words"\nsure?\n\n`
    + `[m3 comment a@v1] "vanished"\n\n[m4 question ${target}] "reply"\n:::`,
  );
  const index = buildReviewIndex([source, prose, feedback]);
  assert.deepEqual(index.discussions.get('a@v1'), [{ quote: 'bold words', markIds: ['m1', 'm2'] }]);
  assert.deepEqual(index.discussions.get(target), [{ quote: 'reply', markIds: ['m4'] }]);
  assert.equal(index.hasPassage('a@v1', 'vanished'), false);
  assert.equal(index.marks.get('m3')?.quote, 'vanished');
});

test('the fingerprint ignores a growing reply but sees a finished one', () => {
  const base = [assistant('done')];
  const streamingA = [...base, assistant('par', { isStreaming: true })];
  const streamingB = [...base, assistant('partial', { isStreaming: true })];
  const finished = [...base, assistant('partial')];
  assert.equal(reviewFingerprint(streamingA), reviewFingerprint(streamingB));
  assert.notEqual(reviewFingerprint(streamingB), reviewFingerprint(finished));
});
