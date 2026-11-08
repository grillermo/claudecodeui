import assert from 'node:assert/strict';
import { test } from 'vitest';

import { prepareSubmission } from '@/modules/review/state/prepareSubmission';

const compose = (typed: string) => `BLOCK\n${typed}`;

test('marks are composed into a normal message', () => {
  assert.deepEqual(prepareSubmission({ typed: 'hi', hasMarks: true, isQueuedResend: false, composeFeedback: compose }), {
    text: 'BLOCK\nhi', consumedMarks: true,
  });
});

test('a tray with empty text still has something to send', () => {
  assert.deepEqual(prepareSubmission({ typed: '', hasMarks: true, isQueuedResend: false, composeFeedback: compose }), {
    text: 'BLOCK\n', consumedMarks: true,
  });
});

test('a slash command is left alone and the tray keeps its marks', () => {
  assert.deepEqual(prepareSubmission({ typed: '/compact', hasMarks: true, isQueuedResend: false, composeFeedback: compose }), {
    text: '/compact', consumedMarks: false,
  });
});

test('a queued resend already holds its block', () => {
  assert.deepEqual(prepareSubmission({ typed: 'BLOCK\nhi', hasMarks: true, isQueuedResend: true, composeFeedback: compose }), {
    text: 'BLOCK\nhi', consumedMarks: false,
  });
});

test('no marks means no change', () => {
  assert.deepEqual(prepareSubmission({ typed: 'hi', hasMarks: false, isQueuedResend: false, composeFeedback: compose }), {
    text: 'hi', consumedMarks: false,
  });
});
