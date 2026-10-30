import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from './api';
import { FeedbackProvider, LiveRegions, useFeedback } from './feedback';
import { TopBar, navPathsFor } from './components/TopBar';
import { SignInScreen } from './screens/SignIn';
import { DialScreen } from './screens/Dial';
import { BookingsScreen } from './screens/Bookings';
import { DocumentsScreen } from './screens/Documents';
import { BillingScreen } from './screens/Billing';
import { TenantsScreen } from './screens/Tenants';
import { SettingsScreen } from './screens/Settings';
import { InspectorScreen } from './screens/Inspector';
import type { User } from './types';

function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((next: string) => {
    if (next !== window.location.pathname) window.history.pushState({}, '', next);
    setPath(next);
  }, []);
  return [path, navigate];
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function Screens({
  user,
  path,
  navigate,
  reducedMotion,
  onSignedIn,
  onSignedOut,
}: {
  user: User | null;
  path: string;
  navigate: (path: string) => void;
  reducedMotion: boolean;
  onSignedIn: (user: User) => void;
  onSignedOut: () => void;
}): JSX.Element {
  const { perform } = useFeedback();

  if (path.startsWith('/inspect/')) {
    return <InspectorScreen token={path.slice('/inspect/'.length)} />;
  }

  if (!user) {
    return (
      <>
        <LiveRegions reducedMotion={reducedMotion} />
        <main>
          <SignInScreen
            onSignedIn={(signedIn) => {
              onSignedIn(signedIn);
              navigate('/');
            }}
          />
        </main>
      </>
    );
  }

  const allowed = navPathsFor(user.role);
  const active = allowed.includes(path) ? path : '/';

  const signOut = async (): Promise<void> => {
    await perform({
      pending: 'Signing out…',
      success: () => '',
      run: () => apiSend<void>('DELETE', '/api/session', null),
    });
    onSignedOut();
    navigate('/signin');
  };

  return (
    <>
      <TopBar user={user} path={active} navigate={navigate} onSignOut={() => void signOut()} />
      <LiveRegions reducedMotion={reducedMotion} />
      <main>
        {active === '/' ? <DialScreen user={user} reducedMotion={reducedMotion} /> : null}
        {active === '/bookings' ? <BookingsScreen user={user} /> : null}
        {active === '/documents' ? <DocumentsScreen user={user} /> : null}
        {active === '/billing' ? <BillingScreen user={user} /> : null}
        {active === '/tenants' ? <TenantsScreen /> : null}
        {active === '/settings' ? <SettingsScreen /> : null}
      </main>
    </>
  );
}

export function App(): JSX.Element {
  const [path, navigate] = usePath();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (window.location.pathname.startsWith('/inspect/')) {
      setReady(true);
      return;
    }
    apiGet<{ user: User }>('/api/session')
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <div />;

  return (
    <FeedbackProvider
      onSessionEnded={() => {
        setUser(null);
        navigate('/signin');
      }}
    >
      <Screens
        user={user}
        path={path}
        navigate={navigate}
        reducedMotion={reducedMotion}
        onSignedIn={setUser}
        onSignedOut={() => setUser(null)}
      />
    </FeedbackProvider>
  );
}
