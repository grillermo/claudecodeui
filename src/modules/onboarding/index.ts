import { lazy } from 'react';

// Loaded on first render: onboarding runs once per account, so its code is kept out of
// the startup bundle. The consumer renders it inside <Suspense>.
export const Onboarding = lazy(() => import('@/modules/onboarding/Onboarding'));
