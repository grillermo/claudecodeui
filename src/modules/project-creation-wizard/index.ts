import { lazy } from 'react';

// Loaded on first render: the wizard's code is kept out of the startup bundle.
// The consumer renders it inside <Suspense>.
export const ProjectCreationWizard = lazy(() => import('@/modules/project-creation-wizard/ProjectCreationWizard'));
