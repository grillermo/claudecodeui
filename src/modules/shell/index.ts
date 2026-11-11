import { lazy } from 'react';

// Loaded on first render: the terminal brings xterm (~400 kB), which a session that never
// opens a shell should not have to parse at startup. Consumers render it inside <Suspense>.
export const Shell = lazy(() => import('@/modules/shell/Shell'));
