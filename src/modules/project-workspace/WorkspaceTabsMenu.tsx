import { ClipboardCheck, Folder, GitBranch, MessageSquare, MonitorPlay, MoreHorizontal, Terminal, type LucideIcon } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionMenu, type ActionMenuItem } from '@/shared/ui';
import type { AppTab } from '@/shared/types';
import { usePlugins, PluginIcon } from '@/modules/plugins';

type WorkspaceTabsMenuProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
};

type BuiltInTab = {
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

const BASE_TABS: BuiltInTab[] = [
  { id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: Folder },
  { id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
];

const BROWSER_TAB: BuiltInTab = { id: 'browser', labelKey: 'tabs.browser', icon: MonitorPlay };

const TASKS_TAB: BuiltInTab = { id: 'tasks', labelKey: 'tabs.tasks', icon: ClipboardCheck };

const getTabTestId = (tabId: AppTab) => `workspace-tab-${tabId.replace(':', '-')}`;

/**
 * Rendered by WorkspaceHeader as a three-dot menu of the built-in workspace tabs
 * plus any enabled plugin tabs, so switching views costs the conversation no
 * header space.
 */
export default function WorkspaceTabsMenu({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
}: WorkspaceTabsMenuProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();
  const menuLabel = t('tabs.views', { defaultValue: 'Workspace views' });

  const builtInTabs: BuiltInTab[] = [
    ...BASE_TABS,
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
  ];

  const builtInItems: ActionMenuItem[] = builtInTabs.map((tab) => ({
    key: tab.id,
    label: t(tab.labelKey),
    icon: tab.icon,
    isSelected: tab.id === activeTab,
    testId: getTabTestId(tab.id),
    onSelect: () => setActiveTab(tab.id),
  }));

  const pluginItems: ActionMenuItem[] = plugins
    .filter((plugin) => plugin.enabled)
    .map((plugin, index) => {
      const tabId = `plugin:${plugin.name}` as AppTab;
      return {
        key: tabId,
        label: plugin.displayName,
        iconElement: (
          <PluginIcon
            pluginName={plugin.name}
            iconFile={plugin.icon}
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-full [&>svg]:w-full"
          />
        ),
        isSelected: tabId === activeTab,
        testId: getTabTestId(tabId),
        showDividerBefore: index === 0,
        onSelect: () => setActiveTab(tabId),
      };
    });

  return (
    <ActionMenu
      label={menuLabel}
      icon={MoreHorizontal}
      iconOnly
      variant="ghost"
      size="icon"
      className="shrink-0"
      triggerClassName="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-foreground"
      triggerTestId="workspace-tabs"
      items={[...builtInItems, ...pluginItems]}
    />
  );
}
