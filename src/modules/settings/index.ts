import { lazy } from 'react';

// Loaded on first render: the settings dialog, with the MCP and skills editors it embeds,
// is kept out of the startup bundle. The consumer renders it inside <Suspense>.
export const Settings = lazy(() => import('@/modules/settings/Settings'));
