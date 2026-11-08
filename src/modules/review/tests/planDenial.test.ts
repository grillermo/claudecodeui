import assert from 'node:assert/strict';
import { test } from 'vitest';

import { findPlanRequestToDeny } from '@/modules/review/state/planDenial';

const plan = { requestId: 'r1', toolName: 'ExitPlanMode' };
const other = { requestId: 'r2', toolName: 'Bash' };

test('a message answers a pending plan', () => {
  assert.equal(findPlanRequestToDeny({ requests: [other, plan], text: 'change it', hasAttachments: false, isQueuedResend: false })?.requestId, 'r1');
});

test('the legacy tool name counts', () => {
  assert.equal(findPlanRequestToDeny({ requests: [{ requestId: 'r3', toolName: 'exit_plan_mode' }], text: 'x', hasAttachments: false, isQueuedResend: false })?.requestId, 'r3');
});

test('slash commands, attachments, queued resends and other tools do not', () => {
  const base = { requests: [plan], text: 'x', hasAttachments: false, isQueuedResend: false };
  assert.equal(findPlanRequestToDeny({ ...base, text: '/compact' }), null);
  assert.equal(findPlanRequestToDeny({ ...base, hasAttachments: true }), null);
  assert.equal(findPlanRequestToDeny({ ...base, isQueuedResend: true }), null);
  assert.equal(findPlanRequestToDeny({ ...base, requests: [other] }), null);
});
