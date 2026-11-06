import assert from 'node:assert/strict';
import test from 'node:test';

import { createClaudeAccountsService } from '@/modules/providers/list/claude/claude-accounts.js';

const CLI = '/bin/claude';
const CSWAP = '/bin/cswap';

type Logins = Record<string, { loggedIn: boolean; email: string | null } | undefined>;

/** A fake machine: `logins` is keyed by config directory, `default` for no directory. */
const createService = (logins: Logins, options: { cswapAccounts?: Array<{ number: number; email: string }> } = {}) => {
  const calls: string[][] = [];
  const accounts = options.cswapAccounts ?? [
    { number: 1, email: 'a@x.com' },
    { number: 2, email: 'b@x.com' },
  ];

  const service = createClaudeAccountsService({
    cliPath: () => CLI,
    cswapPath: () => CSWAP,
    listProfileDirs: async (number) => (logins[`/p/${number}`] ? [`/p/${number}`] : []),
    run: async (command, args, env) => {
      calls.push([command, ...args]);
      if (command === CSWAP) {
        return args[0] === 'list' ? JSON.stringify({ accounts }) : '2.1.0 (Claude Code)\n';
      }
      const login = logins[env.CLAUDE_CONFIG_DIR ?? 'default'];
      if (!login) {
        throw new Error('no login');
      }
      return JSON.stringify({ ...login, subscriptionType: 'pro' });
    },
  });

  return { service, calls };
};

test('listAccounts follows cswap and checks each login with the CLI', async () => {
  const { service } = createService({
    default: { loggedIn: true, email: 'a@x.com' },
    '/p/2': { loggedIn: true, email: 'b@x.com' },
  });

  assert.deepEqual(await service.listAccounts(), [
    { email: 'a@x.com', loggedIn: true, subscriptionType: 'pro' },
    { email: 'b@x.com', loggedIn: true, subscriptionType: 'pro' },
  ]);
});

test('listAccounts marks an account without a working profile as logged out', async () => {
  const { service } = createService({ default: { loggedIn: true, email: 'a@x.com' } });

  const accounts = await service.listAccounts();
  assert.equal(accounts[1].email, 'b@x.com');
  assert.equal(accounts[1].loggedIn, false);
});

test('listAccounts falls back to the default login without cswap', async () => {
  const { service } = createService({ default: { loggedIn: true, email: 'a@x.com' } }, { cswapAccounts: [] });

  assert.deepEqual(await service.listAccounts(), [
    { email: 'a@x.com', loggedIn: true, subscriptionType: 'pro' },
  ]);
});

test('resolveConfigDir readies the account through cswap and returns its profile', async () => {
  const { service, calls } = createService({
    default: { loggedIn: true, email: 'a@x.com' },
    '/p/2': { loggedIn: true, email: 'b@x.com' },
  });

  assert.equal(await service.resolveConfigDir('b@x.com'), '/p/2');
  assert.ok(calls.some((call) => call.join(' ') === `${CSWAP} run b@x.com -- --version`));
});

test('resolveConfigDir returns null for the account on the default login', async () => {
  const { service } = createService({ default: { loggedIn: true, email: 'a@x.com' } });

  assert.equal(await service.resolveConfigDir('a@x.com'), null);
});

test('resolveConfigDir never hands an unknown email to cswap', async () => {
  const { service, calls } = createService({ default: { loggedIn: true, email: 'a@x.com' } });

  await assert.rejects(service.resolveConfigDir('--evil'), /Unknown Claude account/);
  assert.equal(calls.some((call) => call[1] === 'run'), false);
});

test('resolveConfigDir refuses a profile that holds another login', async () => {
  const { service } = createService({
    default: { loggedIn: true, email: 'a@x.com' },
    '/p/2': { loggedIn: true, email: 'someone-else@x.com' },
  });

  await assert.rejects(service.resolveConfigDir('b@x.com'), /not logged in/);
});
