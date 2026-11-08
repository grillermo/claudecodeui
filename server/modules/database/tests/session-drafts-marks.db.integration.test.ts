import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  sessionDraftsDb,
} from '@/modules/database/index.js';

const USER_ID = 1;
const SCOPE = 'session-1';
const MARKS = [{ key: 'k1', kind: 'comment', target: 'a@v1', quote: 'q', note: 'n' }];

async function withDatabase(prepare: (databasePath: string) => void, run: () => void): Promise<void> {
  const previous = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'draft-marks-'));
  const databasePath = path.join(directory, 'auth.db');
  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await writeFile(databasePath, '');
  prepare(databasePath);
  await initializeDatabase();
  getConnection().prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(USER_ID, 'tester', 'hash');
  try {
    run();
  } finally {
    closeConnection();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

const fresh = () => {};
const read = () => sessionDraftsDb.getDrafts(USER_ID)[0];

test('migration adds marks to an existing table', async () => {
  await withDatabase((databasePath) => {
    const db = new Database(databasePath);
    db.exec(`CREATE TABLE session_drafts (
      user_id INTEGER NOT NULL, draft_scope TEXT NOT NULL, draft_text TEXT NOT NULL DEFAULT '',
      queued_message TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, draft_scope))`);
    db.close();
  }, () => {
    const columns = getConnection().prepare('PRAGMA table_info(session_drafts)').all() as { name: string }[];
    assert.ok(columns.some((column) => column.name === 'marks'));
  });
});

test('marks round-trip alone and keep the row alive', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    assert.deepEqual(read().marks, MARKS);
    assert.equal(read().text, '');
  });
});

test('saving text leaves marks alone, and emptying text keeps a row with marks', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    sessionDraftsDb.saveDraftText(USER_ID, SCOPE, 'typing');
    assert.deepEqual(read().marks, MARKS);
    sessionDraftsDb.saveDraftText(USER_ID, SCOPE, '');
    assert.deepEqual(read().marks, MARKS);
  });
});

test('clearing the last marks removes an otherwise empty row', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, []);
    assert.equal(sessionDraftsDb.getDrafts(USER_ID).length, 0);
  });
});

test('saveDraft with nothing left keeps marks', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftMarks(USER_ID, SCOPE, MARKS);
    sessionDraftsDb.saveDraft(USER_ID, SCOPE, { text: '', queuedMessage: null });
    assert.deepEqual(read().marks, MARKS);
  });
});

test('an unparseable value counts as no marks', async () => {
  await withDatabase(fresh, () => {
    sessionDraftsDb.saveDraftText(USER_ID, SCOPE, 'x');
    getConnection().prepare('UPDATE session_drafts SET marks = ?').run('{not json');
    assert.deepEqual(read().marks, []);
  });
});
