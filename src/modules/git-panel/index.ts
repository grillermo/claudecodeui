import { lazy } from 'react';

// Loaded on first render: the git tab's code is kept out of the startup bundle.
// The consumer renders it inside <Suspense>.
export const GitPanel = lazy(() => import('@/modules/git-panel/GitPanel'));
