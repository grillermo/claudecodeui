import assert from 'node:assert/strict';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type { AppTab } from '@/shared/types';

vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({
    plugins: [
      { name: 'enabled-plugin', displayName: 'Enabled Plugin', icon: 'icon.svg', enabled: true },
      { name: 'disabled-plugin', displayName: 'Disabled Plugin', icon: 'icon.svg', enabled: false },
    ],
  }),
  PluginIcon: () => null,
}));

const { default: WorkspaceTabsMenu } = await import('@/modules/project-workspace/WorkspaceTabsMenu');

const renderMenu = ({ activeTab = 'chat' as AppTab, shouldShowTasksTab = false, shouldShowBrowserTab = false } = {}) => {
  const setActiveTab = vi.fn();
  render(
    <WorkspaceTabsMenu
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      shouldShowTasksTab={shouldShowTasksTab}
      shouldShowBrowserTab={shouldShowBrowserTab}
    />,
  );
  return { setActiveTab };
};

const openMenu = () => fireEvent.click(screen.getByTestId('workspace-tabs'));
const isTabListed = (testId: string) => screen.queryByTestId(testId) !== null;

afterEach(cleanup);

test('the tabs stay out of the header until the menu is opened', () => {
  renderMenu();
  assert.equal(isTabListed('workspace-tab-chat'), false);

  openMenu();
  assert.equal(isTabListed('workspace-tab-chat'), true);
});

test('the menu lists the built-in tabs and only the enabled plugins', () => {
  renderMenu();
  openMenu();

  for (const tab of ['chat', 'shell', 'files', 'git']) {
    assert.equal(isTabListed(`workspace-tab-${tab}`), true, `${tab} is listed`);
  }
  assert.equal(isTabListed('workspace-tab-plugin-enabled-plugin'), true);
  assert.equal(isTabListed('workspace-tab-plugin-disabled-plugin'), false);
});

test('the browser and tasks tabs follow their flags', () => {
  renderMenu();
  openMenu();
  assert.equal(isTabListed('workspace-tab-browser'), false);
  assert.equal(isTabListed('workspace-tab-tasks'), false);
  cleanup();

  renderMenu({ shouldShowTasksTab: true, shouldShowBrowserTab: true });
  openMenu();
  assert.equal(isTabListed('workspace-tab-browser'), true);
  assert.equal(isTabListed('workspace-tab-tasks'), true);
});

test('only the active tab is marked as current', () => {
  renderMenu({ activeTab: 'files' });
  openMenu();

  assert.equal(screen.getByTestId('workspace-tab-files').getAttribute('aria-current'), 'true');
  assert.equal(screen.getByTestId('workspace-tab-chat').getAttribute('aria-current'), null);
});

test('choosing a tab switches to it and closes the menu', () => {
  const { setActiveTab } = renderMenu();
  openMenu();

  fireEvent.click(screen.getByTestId('workspace-tab-plugin-enabled-plugin'));

  assert.deepEqual(setActiveTab.mock.calls, [['plugin:enabled-plugin']]);
  assert.equal(isTabListed('workspace-tab-chat'), false);
});

test('the quick settings entry toggles the drawer and shows whether it is open', async () => {
  const { QuickSettingsPanelProvider, useQuickSettingsPanel } = await import('@/modules/quick-settings-panel');

  const OpenState = () => <span data-testid="quick-settings-open">{String(useQuickSettingsPanel().isOpen)}</span>;
  const isOpen = () => screen.getByTestId('quick-settings-open').textContent === 'true';

  render(
    <QuickSettingsPanelProvider>
      <OpenState />
      <WorkspaceTabsMenu activeTab="chat" setActiveTab={vi.fn()} shouldShowTasksTab={false} shouldShowBrowserTab={false} />
    </QuickSettingsPanelProvider>,
  );

  openMenu();
  assert.equal(screen.getByTestId('workspace-quick-settings').getAttribute('aria-current'), null);
  fireEvent.click(screen.getByTestId('workspace-quick-settings'));
  assert.equal(isOpen(), true);

  openMenu();
  assert.equal(screen.getByTestId('workspace-quick-settings').getAttribute('aria-current'), 'true');
  fireEvent.click(screen.getByTestId('workspace-quick-settings'));
  assert.equal(isOpen(), false);
});

test('the quick settings entry is left out without a quick settings provider', () => {
  renderMenu();
  openMenu();
  assert.equal(isTabListed('workspace-quick-settings'), false);
});
