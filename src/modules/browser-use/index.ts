import { lazy } from 'react';

// Loaded on first render: the browser tab's code is kept out of the startup bundle.
// The consumer renders it inside <Suspense>.
export const BrowserUsePanel = lazy(() => import('@/modules/browser-use/BrowserUsePanel'));
export { useBrowserUseEnabled } from '@/modules/browser-use/hooks/useBrowserUseEnabled';
