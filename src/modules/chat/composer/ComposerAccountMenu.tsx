import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

type ClaudeAccount = {
  email: string;
  loggedIn: boolean;
  subscriptionType: string | null;
};

/**
 * Rendered by chat's ChatComposer on a new Claude chat, to choose the account
 * it runs as: the accounts claude-menu offers. Hidden with fewer than two,
 * when there is nothing to choose.
 */
function ComposerAccountMenu() {
  const { t } = useTranslation('chat');
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([]);
  const [selected, setSelected] = useState(() => readUserPreference('claudeAccount', ''));

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await api.claudeAccounts();
        const body = (await response.json()) as { data?: ClaudeAccount[] };
        if (!cancelled) {
          setAccounts(body.data ?? []);
        }
      } catch {
        // Without the list the chat runs on the default login, as it always did.
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (accounts.length < 2) {
    return null;
  }

  const handleChange = (email: string) => {
    setSelected(email);
    writeUserPreference('claudeAccount', email);
  };

  return (
    <select
      aria-label={t('composer.claudeAccount', { defaultValue: 'Claude account' })}
      value={selected}
      onChange={(event) => handleChange(event.target.value)}
      className="h-7 max-w-44 truncate rounded-md border border-border bg-transparent px-1.5 text-xs text-muted-foreground hover:bg-muted"
    >
      <option value="">{t('composer.claudeAccountDefault', { defaultValue: 'Default account' })}</option>
      {accounts.map((account) => (
        <option key={account.email} value={account.email} disabled={!account.loggedIn}>
          {account.loggedIn
            ? account.email
            : `${account.email} (${t('composer.claudeAccountLoggedOut', { defaultValue: 'logged out' })})`}
        </option>
      ))}
    </select>
  );
}

export default memo(ComposerAccountMenu);
