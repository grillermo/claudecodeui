import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { AppError } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 30_000;

/** One Claude account this server can run chats as. */
export type ClaudeAccount = {
  email: string;
  loggedIn: boolean;
  subscriptionType: string | null;
};

export type ClaudeCliLogin = {
  loggedIn: boolean;
  email: string | null;
  subscriptionType: string | null;
};

type ClaudeAccountDependencies = {
  /** Runs a command and resolves with its stdout. */
  run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string>;
  /** The `<number>-*` profile directories cswap keeps for an account. */
  listProfileDirs(accountNumber: number): Promise<string[]>;
  cliPath(): string;
  cswapPath(): string;
};

const swapRoot = () => path.join(os.homedir(), '.claude-swap-backup', 'sessions');

const defaultDependencies: ClaudeAccountDependencies = {
  run: async (command, args, env) => (
    (await execFileAsync(command, args, { env, timeout: COMMAND_TIMEOUT_MS })).stdout
  ),
  listProfileDirs: async (accountNumber) => {
    try {
      const entries = await readdir(swapRoot());
      return entries
        .filter((entry) => entry.startsWith(`${accountNumber}-`))
        .map((entry) => path.join(swapRoot(), entry));
    } catch {
      return [];
    }
  },
  cliPath: () => resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH) ?? 'claude',
  cswapPath: () => process.env.CSWAP_PATH?.trim() || 'cswap',
};

const parseLogin = (stdout: string): ClaudeCliLogin => {
  const status = JSON.parse(stdout) as Record<string, unknown>;
  return {
    loggedIn: status.loggedIn === true,
    email: typeof status.email === 'string' ? status.email : null,
    subscriptionType: typeof status.subscriptionType === 'string' ? status.subscriptionType : null,
  };
};

/** Environment for a CLI that should use `configDir`, or the default login when null. */
const envForConfigDir = (configDir: string | null): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  return configDir ? { ...env, CLAUDE_CONFIG_DIR: configDir } : env;
};

/**
 * Accounts come from cswap, the same list claude-menu offers. Their logins live
 * in the macOS Keychain, under a name derived from the config directory, so
 * only the CLI itself can tell whether one works.
 */
export function createClaudeAccountsService(overrides: Partial<ClaudeAccountDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };

  /** What the CLI says about the login in one config directory. */
  const readLogin = async (configDir: string | null): Promise<ClaudeCliLogin | null> => {
    try {
      return parseLogin(await dependencies.run(
        dependencies.cliPath(),
        ['auth', 'status', '--json'],
        envForConfigDir(configDir),
      ));
    } catch {
      // `claude auth status` exits non-zero when logged out, but still prints.
      return null;
    }
  };

  const readCswapAccounts = async (): Promise<Array<{ number: number; email: string }>> => {
    try {
      const stdout = await dependencies.run(dependencies.cswapPath(), ['list', '--json'], envForConfigDir(null));
      const parsed = JSON.parse(stdout) as { accounts?: Array<{ number?: unknown; email?: unknown }> };
      return (parsed.accounts ?? []).flatMap((account) => (
        typeof account.number === 'number' && typeof account.email === 'string'
          ? [{ number: account.number, email: account.email }]
          : []
      ));
    } catch {
      // No cswap on this machine: the default login is the only account.
      return [];
    }
  };

  /** The profile directory of an account, skipping the fallbacks a missing one needs. */
  const findProfileDir = async (accountNumber: number, email: string): Promise<string | null> => {
    for (const directory of await dependencies.listProfileDirs(accountNumber)) {
      const login = await readLogin(directory);
      if (login?.email === email) {
        return directory;
      }
    }
    return (await dependencies.listProfileDirs(accountNumber))[0] ?? null;
  };

  return {
    readDefaultLogin: () => readLogin(null),

    /** Every account, each with whether its login works right now. */
    async listAccounts(): Promise<ClaudeAccount[]> {
      const defaultLogin = await readLogin(null);
      const accounts = await readCswapAccounts();

      if (accounts.length === 0) {
        return defaultLogin?.loggedIn && defaultLogin.email
          ? [{ email: defaultLogin.email, loggedIn: true, subscriptionType: defaultLogin.subscriptionType }]
          : [];
      }

      return Promise.all(accounts.map(async ({ number, email }) => {
        if (defaultLogin?.email === email) {
          return { email, loggedIn: defaultLogin.loggedIn, subscriptionType: defaultLogin.subscriptionType };
        }

        const directory = await findProfileDir(number, email);
        const login = directory ? await readLogin(directory) : null;
        return {
          email,
          loggedIn: login?.email === email && login.loggedIn,
          subscriptionType: login?.subscriptionType ?? null,
        };
      }));
    },

    /**
     * Readies an account and returns the config directory to run it in, null
     * for the default login.
     *
     * `cswap run` is not used as the executable: it prints a banner to stdout,
     * which the SDK would read as protocol. A throwaway `--version` launch runs
     * the same setup claude-menu gets, so a stale or rotated login is renewed
     * through cswap's own lock rather than by a second copy of the token.
     */
    async resolveConfigDir(email: string): Promise<string | null> {
      const account = (await readCswapAccounts()).find((candidate) => candidate.email === email);
      if (!account) {
        const defaultLogin = await readLogin(null);
        if (defaultLogin?.email === email) {
          return null;
        }
        throw new AppError(`Unknown Claude account: ${email}`, {
          code: 'CLAUDE_ACCOUNT_NOT_FOUND',
          statusCode: 400,
        });
      }

      try {
        await dependencies.run(dependencies.cswapPath(), ['run', email, '--', '--version'], envForConfigDir(null));
      } catch (error) {
        // A profile that is already valid still runs; cswap only failed to refresh it.
        console.warn(`[Claude accounts] cswap could not prepare ${email}:`, error);
      }

      const defaultLogin = await readLogin(null);
      if (defaultLogin?.email === email) {
        return null;
      }

      const directory = await findProfileDir(account.number, email);
      const login = directory ? await readLogin(directory) : null;
      if (!directory || !login?.loggedIn || login.email !== email) {
        throw new AppError(`Claude account ${email} is not logged in. Run: cswap run ${email}`, {
          code: 'CLAUDE_ACCOUNT_NOT_LOGGED_IN',
          statusCode: 409,
        });
      }
      return directory;
    },
  };
}

export const claudeAccountsService = createClaudeAccountsService();
