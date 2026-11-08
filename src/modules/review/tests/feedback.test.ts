import assert from 'node:assert/strict';
import { test } from 'vitest';

import { maxMarkNumber, parseFeedbackBody, serializeFeedback } from '@/modules/review/parsing/feedback';
import { parseReviewSegments } from '@/modules/review/parsing/segments';
import type { FeedbackMark } from '@/modules/review/types';

const SPEC_BLOCK = `:::feedback
[m1 comment upload-plan@v1] "Store uploads in the project's .uploads/ folder"
Use files.chiq.me instead, these need to open on my phone.

[m2 redline upload-plan@v1] "Resize images on the client before upload to keep the transcript light."

[m3 question msg:7f3a0000] "up to 5 MB"
Why 5 MB? iPad screenshots are bigger.
:::
Free text typed in the composer follows the block.`;

test('reads the spec example', () => {
  const [feedback, prose] = parseReviewSegments(SPEC_BLOCK);
  assert.ok(feedback.type === 'feedback');
  assert.deepEqual(feedback.marks.map((m) => [m.id, m.kind, m.target]), [
    ['m1', 'comment', 'upload-plan@v1'],
    ['m2', 'redline', 'upload-plan@v1'],
    ['m3', 'question', 'msg:7f3a0000'],
  ]);
  assert.equal(feedback.marks[0].note, 'Use files.chiq.me instead, these need to open on my phone.');
  assert.equal(feedback.marks[1].note, '');
  assert.equal(prose.type === 'markdown' && prose.text, 'Free text typed in the composer follows the block.');
});

test('round-trips marks, including context and awkward notes', () => {
  const marks: FeedbackMark[] = [
    { id: 'm4', kind: 'comment', target: 'a@v2', quote: 'say "hi" twice', before: 'first', after: 'then', note: 'line one\n\nline three' },
    { id: 'm5', kind: 'question', target: 'msg:abcd1234', quote: 'x', note: ':::\n[m9 comment t] "not a header"' },
  ];
  const block = serializeFeedback(marks);
  const [segment] = parseReviewSegments(block);
  assert.ok(segment.type === 'feedback');
  assert.deepEqual(segment.marks, marks);
});

test('writes context only when present', () => {
  const block = serializeFeedback([
    { id: 'm1', kind: 'redline', target: 't@v1', quote: 'q', note: '' },
    { id: 'm2', kind: 'redline', target: 't@v1', quote: 'q', before: 'b', after: 'a', note: '' },
  ]);
  assert.equal(block, ':::feedback\n[m1 redline t@v1] "q"\n\n[m2 redline t@v1] …b "q" a…\n:::');
});

test('garbled bodies are unreadable, not partially read', () => {
  assert.equal(parseFeedbackBody('no header here'), null);
  assert.equal(parseFeedbackBody('[m1 shout t@v1] "q"'), null);
  assert.equal(parseFeedbackBody('[m1 comment t@v1] unquoted'), null);
  assert.equal(parseFeedbackBody(''), null);
});

test('maxMarkNumber scans any text for feedback blocks', () => {
  assert.equal(maxMarkNumber('nothing'), 0);
  assert.equal(maxMarkNumber(SPEC_BLOCK), 3);
  assert.equal(maxMarkNumber(`denied:\n${SPEC_BLOCK}`), 3);
});

test('reads a block with CRLF line endings', () => {
  const [feedback] = parseReviewSegments(SPEC_BLOCK.replace(/\n/g, '\r\n'));
  assert.ok(feedback.type === 'feedback');
  assert.equal(feedback.marks.length, 3);
  assert.equal(feedback.marks[0].note, 'Use files.chiq.me instead, these need to open on my phone.');
});

test('round-trips note lines that already start with spaces before structure', () => {
  const marks: FeedbackMark[] = [
    { id: 'm1', kind: 'comment', target: 't@v1', quote: 'q', note: 'a\n :::\n  [m2 x\nb' },
  ];
  const [segment] = parseReviewSegments(serializeFeedback(marks));
  assert.ok(segment.type === 'feedback');
  assert.deepEqual(segment.marks, marks);
});

test('empty input is unreadable and writes nothing', () => {
  assert.equal(parseFeedbackBody(''), null);
  assert.equal(parseFeedbackBody('  \n\n'), null);
  assert.equal(serializeFeedback([]), '');
});
