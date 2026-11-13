import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PublishedLimits, User } from '../shared/types.js';
import { apiGet } from './api.js';
import { Landing } from './screens/Landing.js';
import { SignIn } from './screens/SignIn.js';
import { SignUp } from './screens/SignUp.js';
import { Verify } from './screens/Verify.js';
import { Invitation } from './screens/Invitation.js';
import { FileBrowser } from './screens/FileBrowser.js';
import { NotebookScreen } from './screens/NotebookScreen.js';

interface AppState {
  path: string;
  search: string;
  navigate: (to: string) => void;
  user: User | null;
  setUser: (user: User | null) => void;
  limits: PublishedLimits;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('The app context is missing');
  return state;
}

function Screen(): JSX.Element {
  const app = useApp();
  const { path } = app;
  if (path === '/') return <Landing />;
  if (path === '/signin') return <SignIn />;
  if (path === '/signup') return <SignUp />;
  if (path.startsWith('/verify/')) return <Verify token={decodeURIComponent(path.slice('/verify/'.length))} />;
  if (path.startsWith('/invite/')) {
    return <Invitation token={decodeURIComponent(path.slice('/invite/'.length))} />;
  }
  if (path === '/notebooks') return <FileBrowser />;
  if (path.startsWith('/notebooks/')) {
    return <NotebookScreen notebookId={decodeURIComponent(path.slice('/notebooks/'.length))} />;
  }
  return <Landing />;
}

export function App(): JSX.Element {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  const [user, setUser] = useState<User | null>(null);
  const [limits, setLimits] = useState<PublishedLimits | null>(null);
  const [ready, setReady] = useState(false);

  const navigate = useCallback((to: string) => {
    const url = new URL(to, window.location.origin);
    window.history.pushState({}, '', url);
    setLocation({ path: url.pathname, search: url.search });
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = (): void => {
      setLocation({ path: window.location.pathname, search: window.location.search });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    void (async () => {
      const [me, published] = await Promise.all([
        apiGet<{ user: User | null }>('/api/me'),
        apiGet<PublishedLimits>('/api/config'),
      ]);
      setUser(me.user);
      setLimits(published);
      setReady(true);
    })();
  }, []);

  const needsSession = location.path === '/notebooks' || location.path.startsWith('/notebooks/');
  useEffect(() => {
    if (!ready || user !== null || !needsSession) return;
    window.sessionStorage.setItem('brackenpad.return_to', `${location.path}${location.search}`);
    navigate('/signin');
  }, [ready, user, needsSession, location.path, location.search, navigate]);

  const value = useMemo<AppState | null>(
    () =>
      limits === null
        ? null
        : { path: location.path, search: location.search, navigate, user, setUser, limits },
    [limits, location.path, location.search, navigate, user],
  );

  if (!ready || value === null) return <div className="boot" />;
  return (
    <AppContext.Provider value={value}>
      <Screen />
    </AppContext.Provider>
  );
}
