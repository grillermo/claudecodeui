import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useQuickSettingsPanelState } from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelState';

type QuickSettingsPanelControls = ReturnType<typeof useQuickSettingsPanelState> & {
  // False on mobile, where the panel is always an overlay.
  canPin: boolean;
};

const QuickSettingsPanelContext = createContext<QuickSettingsPanelControls | null>(null);

/**
 * Mounted by the project-workspace module around the workspace so the panel and
 * whatever opens it (the header's three-dot menu) share one open/pinned/tab state.
 */
export function QuickSettingsPanelProvider({ children }: { children: ReactNode }) {
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const canPin = !isMobile;
  const state = useQuickSettingsPanelState({ canPin });
  const value = useMemo(() => ({ ...state, canPin }), [state, canPin]);

  return (
    <QuickSettingsPanelContext.Provider value={value}>
      {children}
    </QuickSettingsPanelContext.Provider>
  );
}

/** Used by QuickSettingsPanelView and the workspace tabs menu to read and drive the quick settings drawer. */
export function useQuickSettingsPanel(): QuickSettingsPanelControls {
  const context = useContext(QuickSettingsPanelContext);
  if (!context) {
    throw new Error('useQuickSettingsPanel must be used inside a QuickSettingsPanelProvider');
  }
  return context;
}

/** Like useQuickSettingsPanel, but returns null outside a provider (for components that also render standalone, e.g. in tests). */
export function useOptionalQuickSettingsPanel(): QuickSettingsPanelControls | null {
  return useContext(QuickSettingsPanelContext);
}
