import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LimitsDto, SessionUser } from '../shared/api';
import { ApiFailure, NetworkFailure, api } from './lib/api';
import { matchRoute, navigate, useRoute } from './lib/router';
import { Notices, NotFoundScreen, ServiceBanner, TopBar } from './components/shell';
import { SignInScreen } from './screens/signin';
import { ListScreen } from './screens/list';
import { WorkbookScreen } from './screens/workbook';
import { StationScreen } from './screens/station';
import { InviteScreen } from './screens/invite';
import { ShareScreen } from './screens/share';

const USER_KEY = 'furrowbook:user';

function cachedUser(): SessionUser | null {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

function App(): JSX.Element {
  const path = useRoute();
  const route = matchRoute(path);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [limits, setLimits] = useState<LimitsDto | null>(null);

  const readSession = useCallback(async () => {
    try {
      const result = await api<{ user: SessionUser }>('/api/session');
      setUser(result.user);
      window.localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 401) {
        window.localStorage.removeItem(USER_KEY);
        setUser(null);
      } else if (failure instanceof NetworkFailure) {
        setUser(cachedUser());
      }
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void readSession();
    void api<LimitsDto>('/api/limits').then(setLimits, () => undefined);
  }, [readSession]);

  useEffect(() => {
    if (!checked) return;
    const open = route.name === 'signin' || route.name === 'invite' || route.name === 'share';
    if (!user && !open) navigate('/signin');
    if (user && route.name === 'signin') navigate('/');
  }, [checked, user, route.name]);

  if (route.name === 'share') return <ShareScreen token={route.param} />;

  if (route.name === 'invite') {
    return (
      <InviteScreen
        token={route.param}
        onAccepted={(accepted) => {
          window.localStorage.setItem(USER_KEY, JSON.stringify(accepted));
          setUser(accepted);
          navigate('/');
        }}
      />
    );
  }

  if (!checked) return <main className="centre-screen" />;

  if (!user) {
    return (
      <SignInScreen
        onSignedIn={(signedIn) => {
          window.localStorage.setItem(USER_KEY, JSON.stringify(signedIn));
          setUser(signedIn);
          navigate('/');
        }}
      />
    );
  }

  const signOut = async () => {
    await api('/api/session', { method: 'DELETE' });
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
    navigate('/signin');
  };

  return (
    <div className="app-shell">
      <TopBar user={user} onSignOut={() => void signOut()} />
      <ServiceBanner />
      {route.name === 'list' ? <ListScreen user={user} limits={limits} /> : null}
      {route.name === 'workbook' ? <WorkbookScreen workbookId={route.param} user={user} /> : null}
      {route.name === 'station' ? (
        user.role === 'data_manager' ? (
          <StationScreen user={user} onStationChanged={() => void readSession()} />
        ) : (
          <NotFoundScreen />
        )
      ) : null}
      {route.name === 'unknown' ? <NotFoundScreen /> : null}
      <Notices />
    </div>
  );
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
