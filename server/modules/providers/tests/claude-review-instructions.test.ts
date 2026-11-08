import assert from 'node:assert/strict';
import test from 'node:test';

import { mapCliOptionsToSDK } from '@/modules/providers/list/claude/claude-runtime.provider.js';
import { REVIEW_INSTRUCTIONS } from '@/modules/providers/list/claude/review-instructions.js';

test('interactive runs get the review instructions on the Claude Code preset', () => {
  assert.deepEqual(mapCliOptionsToSDK({ model: 'sonnet' }).systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
    append: REVIEW_INSTRUCTIONS,
  });
});

test('unattended runs get the plain preset', () => {
  assert.deepEqual(mapCliOptionsToSDK({ model: 'sonnet', unattended: true }).systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
  });
});

test('the instructions cover each rule the UI depends on', () => {
  for (const phrase of [':::doc id=', 'addresses=', ':::feedback', 'redline', 'never use the id `plan`']) {
    assert.ok(REVIEW_INSTRUCTIONS.includes(phrase), phrase);
  }
  assert.ok(REVIEW_INSTRUCTIONS.split(/\s+/).length <= 340);
});
