import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

import type * as Api from '@/shared/api';

const saved: Array<{ scope: string; text: string; marks?: unknown }> = [];
let serverDrafts: unknown[] = [];
let saveFails = false;

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  api: {
    user: {
      drafts: async () => new Response(JSON.stringify({ success: true, drafts: serverDrafts }), { status: 200 }),
      saveDraft: async (scope: string, draft: { text: string; marks?: unknown }) => {
        saved.push({ scope, ...draft });
        return new Response('{}', { status: saveFails ? 500 : 200 });
      },
    },
  },
}));

const loadStore = async () => {
  vi.resetModules();
  return import('@/shared/chatDrafts');
};
const MARK = { key: 'k1', kind: 'comment' as const, target: 'a@v1', quote: 'q', note: '' };

beforeEach(() => {
  localStorage.clear();
  saved.length = 0;
  serverDrafts = [];
  saveFails = false;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const flush = async () => {
  await vi.advanceTimersByTimeAsync(1_100);
};

test('writes marks to the server, and only for scopes whose marks changed', async () => {
  const store = await loadStore();
  store.writeDraftMarks('s1', [MARK]);
  await flush();
  assert.deepEqual(saved, [{ scope: 's1', text: '', marks: [MARK] }]);
  saved.length = 0;
  store.writeDraftText('s1', 'hello');
  await flush();
  assert.deepEqual(saved, [{ scope: 's1', text: 'hello' }]);
});

test('marks reload from the mirror and from the server', async () => {
  const first = await loadStore();
  first.writeDraftMarks('s1', [MARK]);
  const reloaded = await loadStore();
  assert.deepEqual(reloaded.readDraftMarks('s1'), [MARK]);

  serverDrafts = [{ scope: 's2', text: '', queuedMessage: null, marks: [MARK] }];
  await reloaded.hydrateChatDrafts();
  assert.deepEqual(reloaded.readDraftMarks('s2'), [MARK]);
});

test('hydrate does not replace marks still waiting to be written', async () => {
  const store = await loadStore();
  serverDrafts = [{ scope: 's1', text: '', queuedMessage: null, marks: [] }];
  store.writeDraftMarks('s1', [MARK]);
  await store.hydrateChatDrafts();
  assert.deepEqual(store.readDraftMarks('s1'), [MARK]);
});

test('a failed save is reported and cleared by the next good one', async () => {
  const store = await loadStore();
  saveFails = true;
  store.writeDraftMarks('s1', [MARK]);
  await flush();
  assert.equal(store.didDraftMarksSaveFail('s1'), true);
  assert.deepEqual(store.readDraftMarks('s1'), [MARK]);
  saveFails = false;
  store.writeDraftMarks('s1', []);
  await flush();
  assert.equal(store.didDraftMarksSaveFail('s1'), false);
});
