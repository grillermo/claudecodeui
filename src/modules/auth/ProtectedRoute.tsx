import { Suspense } from 'react';
import type { ReactNode } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import { useAuth } from '@/modules/auth/context/AuthContext';
import { Onboarding } from '@/modules/onboarding';
import AuthLoadingScreen from '@/modules/auth/AuthLoadingScreen';
import LoginForm from '@/modules/auth/LoginForm';
import SetupForm from '@/modules/auth/SetupForm';

type ProtectedRouteProps = {
  children: ReactNode;
};

/** Used by App to gate the routed application behind setup, login and onboarding. */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, needsSetup, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  // Onboarding is a lazy export; the loading screen stays up while its chunk is fetched.
  const onboarding = (
    <Suspense fallback={<AuthLoadingScreen />}>
      <Onboarding onComplete={refreshOnboardingStatus} />
    </Suspense>
  );

  if (IS_PLATFORM) {
    if (!hasCompletedOnboarding) {
      return onboarding;
    }

    return <>{children}</>;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    return <LoginForm />;
  }

  if (!hasCompletedOnboarding) {
    return onboarding;
  }

  return <>{children}</>;
}
