import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { test, vi } from 'vitest';

import PermissionContext from '@/modules/chat/context/PermissionContext';
import { PlanDisplay } from '@/modules/chat/tools/PlanDisplay';
import { buildReviewIndex, ReviewContext, type ReviewContextValue } from '@/modules/review';
import type { ChatMessage } from '@/shared/types';

vi.mock('@/modules/chat/transcript/reviewMarkdown', () => ({
  renderReviewMarkdown: (markdown: string) => <div data-testid="md">{markdown}</div>,
}));

const plan = (toolId: string, text: string) => ({
  type: 'assistant', content: '', timestamp: 0, isToolUse: true,
  toolName: 'ExitPlanMode', toolId, toolInput: JSON.stringify({ plan: text }),
}) as ChatMessage;

const show = (toolId: string, content: string, permission: unknown, toolResult?: unknown) => render(
  <ReviewContext.Provider value={{ index: buildReviewIndex([plan('t1', 'old words here'), plan('t2', 'new words here')]) } as ReviewContextValue}>
    <PermissionContext.Provider value={permission as never}>
      <PlanDisplay title="Plan" content={content} defaultOpen toolName="ExitPlanMode" toolId={toolId} toolResult={toolResult as never} />
    </PermissionContext.Provider>
  </ReviewContext.Provider>,
);

const pending = { pendingPermissionRequests: [{ requestId: 'r', toolName: 'ExitPlanMode' }], handlePermissionDecision: vi.fn() };

test('a resubmitted plan shows as v2 with its target and changes', () => {
  const { container } = show('t2', 'new words here', pending);
  assert.ok(container.querySelector('[data-review-target="plan@v2"]'));
  assert.ok(screen.getByTestId('review-toggle-changes'));
});

test('Build is the only decision button', () => {
  show('t1', 'old words here', pending);
  assert.ok(screen.getByRole('button', { name: /build/i }));
  assert.equal(screen.queryByRole('button', { name: /revise/i }), null);
});

test('a denial shows its feedback round', () => {
  const content = ':::feedback\n[m1 comment plan@v1] "old words"\nno\n:::';
  const { container } = show('t1', 'old words here', { pendingPermissionRequests: [] }, { isError: true, content });
  assert.ok(container.querySelector('#review-mark-m1'));
});
