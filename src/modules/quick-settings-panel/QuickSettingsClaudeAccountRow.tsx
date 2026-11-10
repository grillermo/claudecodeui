import { UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { SETTING_ROW_CLASS } from '@/shared/constants';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

type ClaudeAccount = {
  email: string;
  loggedIn: boolean;
  subscriptionType: string | null;
};

/**
 * Rendered by QuickSettingsContent to choose the account new Claude chats and
 * shells run as: the accounts claude-menu offers. Hidden with fewer than two,
 * when there is nothing to choose. A resumed session keeps the account that owns it.
 */
export default function QuickSettingsClaudeAccountRow() {
  const { t } = useTranslation('settings');
  // The accounts the server reports; empty until the request answers, which keeps the row hidden.
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([]);
  // Mirrors the stored preference so the select updates as soon as it is changed.
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

  const label = t('quickSettings.claudeAccount', { defaultValue: 'Claude account' });

  return (
    <>
      <div className={SETTING_ROW_CLASS}>
        <span className="flex items-center gap-2 text-sm text-foreground">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          {label}
        </span>
        <select
          aria-label={label}
          value={selected}
          data-testid="quick-settings-account-select"
          onChange={(event) => handleChange(event.target.value)}
          className="w-auto min-w-[120px] max-w-[160px] truncate rounded-lg border border-input bg-card p-2 text-sm text-foreground"
        >
          <option value="">{t('quickSettings.claudeAccountDefault', { defaultValue: 'Default account' })}</option>
          {accounts.map((account) => (
            <option key={account.email} value={account.email} disabled={!account.loggedIn}>
              {account.loggedIn
                ? account.email
                : `${account.email} (${t('quickSettings.claudeAccountLoggedOut', { defaultValue: 'logged out' })})`}
            </option>
          ))}
        </select>
      </div>
      <p className="ml-3 text-xs text-muted-foreground">
        {t('quickSettings.claudeAccountDescription', { defaultValue: 'Used when a new Claude chat or shell starts.' })}
      </p>
    </>
  );
}
