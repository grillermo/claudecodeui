import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { ChatMessage, PendingPermissionRequest, PermissionMode, Project, ProjectSession } from '@/shared/types';

/** A message typed while a plan waits for a decision answers it as a denial. */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };
const MARK = { key: 'k1', kind: 'comment' as const, target: 'plan@v1', quote: 'a passage', note: 'note' };
const BLOCK = ':::feedback\n- k1\n:::';

let order: string[];

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const fakeServer = async (url: RequestInfo | URL): Promise<Response> => (
  String(url).includes('/api/user/drafts') ? json({ success: true, drafts: [] }) : json([])
);

const render = (requests: PendingPermissionRequest[]) => {
  const sendMessage = vi.fn((frame: { type: string }) => { order.push(frame.type); });
  const clearMarks = vi.fn(() => { order.push('clear'); });
  const setPendingPermissionRequests = vi.fn();
  const view = renderHook(() => useChatComposerState({
    selectedProject: PROJECT,
    selectedSession: SESSION,
    currentSessionId: SESSION.id ?? null,
    provider: 'claude',
    permissionMode: 'default',
    cyclePermissionMode: () => undefined,
    resolvePermissionModeForProvider: () => 'default' as PermissionMode,
    currentProviderModel: 'model-1',
    currentProviderEffort: 'medium',
    isLoading: true,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage: sendMessage as never,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    pendingPermissionRequests: requests,
    setPendingPermissionRequests,
    review: { marks: [MARK], composeFeedback: (typed: string) => `${BLOCK}\n${typed}`, clearMarks } as never,
  }));
  return { view, sendMessage, clearMarks, setPendingPermissionRequests };
};

type View = ReturnType<typeof render>['view'];

const submit = async (view: View, text: string) => {
  await act(async () => { view.result.current.setInput(text); });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

beforeEach(() => {
  order = [];
  resetChatDrafts();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(fakeServer));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetChatDrafts();
  localStorage.clear();
});

test('a message with a plan pending denies it with the composed feedback', async () => {
  const { view, sendMessage, clearMarks, setPendingPermissionRequests } = render([
    { requestId: 'r1', toolName: 'ExitPlanMode' },
  ]);

  await submit(view, 'change it');

  assert.equal(sendMessage.mock.calls.length, 1);
  const frame = (sendMessage.mock.calls[0] as unknown as [Record<string, unknown>])[0];
  assert.equal(frame.type, 'chat.permission-response');
  assert.equal(frame.requestId, 'r1');
  assert.equal(frame.allow, false);
  assert.equal(frame.message, `${BLOCK}\nchange it`);
  assert.ok(!order.includes('chat.send'));
  assert.deepEqual(order, ['chat.permission-response', 'clear']);
  assert.equal(clearMarks.mock.calls.length, 1);

  const updater = (setPendingPermissionRequests.mock.calls[0] as unknown as [
    (previous: PendingPermissionRequest[]) => PendingPermissionRequest[],
  ])[0];
  assert.deepEqual(updater([
    { requestId: 'r1', toolName: 'ExitPlanMode' },
    { requestId: 'r2', toolName: 'Bash' },
  ]).map((request) => request.requestId), ['r2']);
});

test('a pending request for another tool is left alone', async () => {
  const { view, sendMessage, setPendingPermissionRequests } = render([
    { requestId: 'r2', toolName: 'Bash' },
  ]);

  await submit(view, 'later');

  for (const call of sendMessage.mock.calls as unknown as Array<[{ type: string }]>) {
    assert.notEqual(call[0].type, 'chat.permission-response');
  }
  assert.equal(setPendingPermissionRequests.mock.calls.length, 0);
});

test('editing an earlier message is not hijacked into a plan denial', async () => {
  const { view, sendMessage, setPendingPermissionRequests } = render([
    { requestId: 'r1', toolName: 'ExitPlanMode' },
  ]);

  await act(async () => {
    view.result.current.beginEditMessage({
      type: 'user', content: 'old', timestamp: 0, transcriptAnchorId: 'anchor-1',
    } as ChatMessage);
  });
  await submit(view, 'edited');

  for (const call of sendMessage.mock.calls as unknown as Array<[{ type: string }]>) {
    assert.notEqual(call[0].type, 'chat.permission-response');
  }
  assert.equal(setPendingPermissionRequests.mock.calls.length, 0);
});
