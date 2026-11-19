import { useEffect } from 'react';
import { useSession } from './api/session';
import { AppHeader, useRoute, navigate } from './shell';
import { SignInScreen, TrialScreen, JoinScreen } from './screens/AuthScreens';
import { SettingsScreen } from './screens/SettingsScreen';
import { WorkspaceScreen, OperationsScreen } from './screens/WorkspaceScreen';
import { DaybookScreen } from './daybook/DaybookScreen';

export function App(): JSX.Element {
  const route = useRoute();
  const { me, loading } = useSession();

  useEffect(() => {
    const publicPages = route.page === 'signin' || route.page === 'trial' || route.page === 'join';
    if (!loading && me === null && !publicPages) navigate('/signin');
  }, [me, loading, route]);

  if (route.page === 'signin') return <SignInScreen />;
  if (route.page === 'trial') return <TrialScreen />;
  if (route.page === 'join') return <JoinScreen token={route.token} />;

  if (loading || me === null) {
    return (
      <>
        <AppHeader current={route} />
        <main className="auth-page"><p>Loading…</p></main>
      </>
    );
  }

  return (
    <>
      <AppHeader current={route} />
      {route.page === 'settings' ? <SettingsScreen /> : null}
      {route.page === 'workspace' ? <WorkspaceScreen /> : null}
      {route.page === 'operations' ? <OperationsScreen /> : null}
      {route.page === 'daybook' ? <DaybookScreen /> : null}
    </>
  );
}
