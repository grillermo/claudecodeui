import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  findClaudeConfigDirForTranscript,
  getClaudeConfigDirs,
  withClaudeConfigDirForTranscript,
} from '@/shared/claude-config-dirs.js';

const home = '/home/me';
const defaultDir = path.join(home, '.claude');
const accountA = '/accounts/a';
const accountB = '/accounts/b';
const dirs = [defaultDir, accountA, accountB];

describe('getClaudeConfigDirs', () => {
  it('is just ~/.claude with nothing configured', () => {
    assert.deepEqual(getClaudeConfigDirs({}, home), [defaultDir]);
  });

  it('adds CLAUDE_CONFIG_DIR and the extra list without duplicates or blanks', () => {
    const env = {
      CLAUDE_CONFIG_DIR: accountA,
      CLAUDE_EXTRA_CONFIG_DIRS: [accountA, '', accountB, ''].join(path.delimiter),
    };
    assert.deepEqual(getClaudeConfigDirs(env, home), dirs);
  });
});

describe('findClaudeConfigDirForTranscript', () => {
  it('finds the directory that owns a transcript', () => {
    assert.equal(findClaudeConfigDirForTranscript('/accounts/b/projects/-x/1.jsonl', dirs), accountB);
  });

  it('does not match a sibling that shares the prefix', () => {
    assert.equal(findClaudeConfigDirForTranscript('/accounts/a2/projects/-x/1.jsonl', dirs), null);
    assert.equal(findClaudeConfigDirForTranscript('/accounts/a/projects-old/1.jsonl', dirs), null);
  });
});

describe('withClaudeConfigDirForTranscript', () => {
  it('points the CLI at the owning account', () => {
    const env = withClaudeConfigDirForTranscript({ KEEP: '1' }, '/accounts/a/projects/-x/1.jsonl', dirs, home);
    assert.deepEqual(env, { KEEP: '1', CLAUDE_CONFIG_DIR: accountA });
  });

  it('unsets the variable for ~/.claude', () => {
    const env = withClaudeConfigDirForTranscript(
      { CLAUDE_CONFIG_DIR: accountA },
      path.join(defaultDir, 'projects', '-x', '1.jsonl'),
      dirs,
      home,
    );
    assert.deepEqual(env, {});
  });

  it('leaves the environment alone for an unknown or missing transcript', () => {
    const base = { CLAUDE_CONFIG_DIR: accountA };
    assert.equal(withClaudeConfigDirForTranscript(base, null, dirs, home), base);
    assert.equal(withClaudeConfigDirForTranscript(base, '/elsewhere/1.jsonl', dirs, home), base);
  });
});
