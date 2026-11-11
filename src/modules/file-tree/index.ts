import { lazy } from 'react';

// Loaded on first render: the files tab's code (and jszip, for folder downloads) is kept
// out of the startup bundle. The consumer renders it inside <Suspense>.
export const FileTree = lazy(() => import('@/modules/file-tree/FileTree'));
