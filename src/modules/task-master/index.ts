import { lazy } from 'react';

// Loaded on first render: the tasks tab brings the PRD editor and CodeMirror, and only
// exists for projects that use TaskMaster. The consumer renders it inside <Suspense>.
export const TaskMasterPanel = lazy(() => import('@/modules/task-master/TaskMasterPanel'));
export { default as NextTaskBanner } from '@/modules/task-master/NextTaskBanner';
export { TaskMasterProvider, useTaskMaster } from '@/modules/task-master/context/TaskMasterContext';
export { TasksSettingsProvider, useTasksSettings } from '@/modules/task-master/context/TasksSettingsContext';
export { useTaskMasterProjectSync } from '@/modules/task-master/hooks/useTaskMasterProjectSync';
