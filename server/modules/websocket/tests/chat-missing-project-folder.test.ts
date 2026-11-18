import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

const SESSION_ID = 'missing-folder-session';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

type RunCall = { provider: string; command: string; options: Record<string, unknown> };

/**
 * Runs a chat gateway whose one session lives in `projectPath`, with a stub
 * runtime that records each run it is asked to start.
 */
async function withGateway(
  resolveProjectPath: (tempDirectory: string) => string,
  runTest: (context: { socket: ReturnType<typeof createFakeSocket>; runs: RunCall[] }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-missing-folder-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const runs: RunCall[] = [];
  const socket = createFakeSocket();

  try {
    const now = new Date().toISOString();
    sessionsDb.createSession(SESSION_ID, 'claude', resolveProjectPath(tempDirectory), 'Session', now, now, null);

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          run: async (runProvider: string, command: string, options: Record<string, unknown>) => {
            runs.push({ provider: runProvider, command, options });
          },
        } as never,
      },
    );

    await runTest({ socket, runs });
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** The handler is async and the socket listener does not await it. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

test('a send in a project whose folder is gone reports it instead of starting the provider', async () => {
  let missingPath = '';
  await withGateway(
    (tempDirectory) => {
      missingPath = path.join(tempDirectory, 'moved-away');
      return missingPath;
    },
    async ({ socket, runs }) => {
      socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello' }));
      await settle();

      assert.equal(runs.length, 0, 'the provider runtime is never started');

      const error = socket.frames.find((frame) => frame.kind === 'error');
      assert.ok(error, 'an error message is sent to the chat');
      assert.match(String(error?.content), /no longer exists/);
      assert.ok(String(error?.content).includes(missingPath), 'the error names the missing folder');

      const complete = socket.frames.find((frame) => frame.kind === 'complete');
      assert.ok(complete, 'the run still ends with a terminal complete');
      assert.equal(complete?.success, false);
    },
  );
});

test('a send whose client cwd is a missing folder is refused too', async () => {
  await withGateway(
    (tempDirectory) => tempDirectory,
    async ({ socket, runs }) => {
      socket.emit('message', JSON.stringify({
        type: 'chat.send',
        sessionId: SESSION_ID,
        content: 'hello',
        options: { cwd: '/definitely/not/a/real/folder' },
      }));
      await settle();

      assert.equal(runs.length, 0);
      assert.ok(socket.frames.some((frame) => frame.kind === 'error'));
    },
  );
});

test('a send in an existing project folder starts the provider as usual', async () => {
  await withGateway(
    (tempDirectory) => tempDirectory,
    async ({ socket, runs }) => {
      socket.emit('message', JSON.stringify({ type: 'chat.send', sessionId: SESSION_ID, content: 'hello' }));
      await settle();

      assert.equal(runs.length, 1);
      assert.ok(!socket.frames.some((frame) => frame.kind === 'error'));
    },
  );
});
