import assert from 'node:assert/strict';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';

const { claudeAccounts } = vi.hoisted(() => ({ claudeAccounts: vi.fn() }));

vi.mock('@/shared/api', () => ({ api: { claudeAccounts } }));

const { readUserPreference, writeUserPreference } = await import('@/shared/userSettings');

const { default: QuickSettingsClaudeAccountRow } = await import(
  '@/modules/quick-settings-panel/QuickSettingsClaudeAccountRow'
);

const answerWith = (emails: string[]) => {
  claudeAccounts.mockResolvedValue({
    json: async () => ({ data: emails.map((email) => ({ email, loggedIn: true, subscriptionType: null })) }),
  });
};

const SELECT_ID = 'quick-settings-account-select';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  writeUserPreference('claudeAccount', '');
});

test('the row stays hidden with fewer than two accounts', async () => {
  answerWith(['one@example.com']);
  render(<QuickSettingsClaudeAccountRow />);

  await waitFor(() => assert.equal(claudeAccounts.mock.calls.length, 1));
  await Promise.resolve();
  assert.equal(screen.queryByTestId(SELECT_ID), null);
});

test('choosing an account stores it for the next new chat', async () => {
  answerWith(['one@example.com', 'two@example.com']);
  render(<QuickSettingsClaudeAccountRow />);

  const select = await screen.findByTestId(SELECT_ID);
  fireEvent.change(select, { target: { value: 'two@example.com' } });

  assert.equal(readUserPreference('claudeAccount', ''), 'two@example.com');
  assert.equal((select as HTMLSelectElement).value, 'two@example.com');
});
