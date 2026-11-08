import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { resetChatDrafts } from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession } from '@/shared/types';

/** Marks in the review tray travel with the next message and are cleared only once it is sent or queued. */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };
const MARK = { key: 'k1', kind: 'comment' as const, target: 'a@v1', quote: 'a passage', note: 'note' };
const BLOCK = ':::feedback\n- k1\n:::';

let uploadFails = false;
let order: string[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const fakeServer = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const path = String(url);
  if (path.includes('/api/assets/files')) {
    if (uploadFails) return json({ error: 'nope' }, 500);
    return json({ attachments: [{ name: 'a.txt', path: '/uploads/a.txt' }] });
  }
  if (path.endsWith('/api/user/drafts/queued-message') && init?.method === 'POST') {
    order.push('queue');
    const body = JSON.parse(String(init.body)) as { queuedMessage: unknown };
    return json({ success: true, queuedMessage: body.queuedMessage, appended: false });
  }
  if (path.includes('/api/user/drafts')) return json({ success: true, drafts: [] });
  return json([]);
};

const render = (isLoading: boolean, marks = [MARK]) => {
  const sendMessage = vi.fn(() => { order.push('send'); });
  const clearMarks = vi.fn(() => { order.push('clear'); });
  const composeFeedback = vi.fn((typed: string) => `${BLOCK}\n${typed}`);
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
    isLoading,
    canAbortSession: false,
    tokenBudget: null,
    sendMessage,
    scrollToBottom: () => undefined,
    addMessage: () => undefined,
    setIsUserScrolledUp: () => undefined,
    setPendingPermissionRequests: () => undefined,
    review: { marks, composeFeedback, clearMarks } as never,
  }));
  return { view, sendMessage, clearMarks, composeFeedback };
};

type View = ReturnType<typeof render>['view'];

const submit = async (view: View, text: string, files: File[] = []) => {
  await act(async () => {
    view.result.current.setInput(text);
    view.result.current.setAttachedFiles(files);
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

beforeEach(() => {
  uploadFails = false;
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

test('a marks-only send carries the composed feedback block and clears the tray once, right before sending', async () => {
  const { view, sendMessage, clearMarks } = render(false);

  await submit(view, '');

  assert.equal(sendMessage.mock.calls.length, 1);
  const frame = (sendMessage.mock.calls[0] as unknown as [{ content: string }])[0];
  assert.equal(frame.content, `${BLOCK}\n`);
  assert.equal(clearMarks.mock.calls.length, 1);
  assert.deepEqual(order, ['clear', 'send']);
});

test('a failed file upload keeps the marks', async () => {
  uploadFails = true;
  const { view, sendMessage, clearMarks } = render(false);

  await submit(view, 'hi', [new File(['a'], 'a.txt', { type: 'text/plain' })]);

  assert.equal(sendMessage.mock.calls.length, 0);
  assert.equal(clearMarks.mock.calls.length, 0);
});

test('a slash command is sent as typed and keeps the marks', async () => {
  const { view, sendMessage, clearMarks, composeFeedback } = render(false);

  await submit(view, '/compact');

  assert.equal(composeFeedback.mock.calls.length, 0, 'no block in front of a command');
  assert.equal(clearMarks.mock.calls.length, 0);
  for (const call of sendMessage.mock.calls as unknown as Array<[{ content: string }]>) {
    assert.equal(call[0].content, '/compact');
  }
});

test('queueing behind a running turn clears the marks right before the queue append', async () => {
  const { view, sendMessage, clearMarks } = render(true);

  await submit(view, 'later');

  assert.equal(sendMessage.mock.calls.length, 0);
  assert.equal(clearMarks.mock.calls.length, 1);
  assert.deepEqual(order, ['clear', 'queue']);
  assert.equal(view.result.current.queuedDraft?.content, `${BLOCK}\nlater`);
});
