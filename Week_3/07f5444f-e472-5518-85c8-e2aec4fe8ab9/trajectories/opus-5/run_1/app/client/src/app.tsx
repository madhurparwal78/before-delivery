import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ServiceStatus, User } from '../../shared/api.js';
import { api } from './api.js';
import { Desk } from './screens/desk.js';
import { FolderScreen, FolderList } from './screens/folder.js';
import { Rentals } from './screens/rentals.js';
import { SectionDesk } from './screens/section-desk.js';
import { SignIn } from './screens/sign-in.js';
import { useInterval, useVisibilityReturn } from './ui.js';

export const STORE_OFFLINE_BANNER =
  "The score store is offline. Scans can't be uploaded or opened right now. Catalogue, counts and cuts still work.";
export const MAIL_OFFLINE_BANNER = "Mail is offline. Notices are queued and will be sent when it's back.";

export interface AppState {
  user: User;
  status: ServiceStatus;
  statusTick: number;
  visibilityTick: number;
  navigate: (path: string) => void;
  path: string;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('the app context is only available inside the signed-in app');
  return state;
}

function landingRoute(user: User): string {
  if (user.role === 'principal_librarian' || user.role === 'assistant_librarian') return '/desk';
  if (user.role === 'section_principal') return '/section';
  return '/folder';
}

function usePath(): [string, (path: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search);
  useEffect(() => {
    const listener = (): void => setPath(window.location.pathname + window.location.search);
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);
  const navigate = useCallback((next: string) => {
    if (next !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', next);
    }
    setPath(next);
  }, []);
  return [path, navigate];
}

export function App(): JSX.Element {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [status, setStatus] = useState<ServiceStatus>({ storage: 'up', mail: 'up' });
  const [statusTick, setStatusTick] = useState(0);
  const [visibilityTick, setVisibilityTick] = useState(0);
  const [path, navigate] = usePath();

  useEffect(() => {
    api
      .session()
      .then((answer) => setUser(answer.user))
      .catch(() => setUser(null));
  }, []);

  const checkStatus = useCallback(() => {
    api
      .serviceStatus()
      .then((answer) => {
        setStatus(answer);
        setStatusTick((tick) => tick + 1);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (user) checkStatus();
  }, [user, checkStatus]);
  useInterval(() => {
    if (user) checkStatus();
  }, 30_000);
  useVisibilityReturn(() => setVisibilityTick((tick) => tick + 1));

  const route = path.split('?')[0] ?? '/';

  useEffect(() => {
    if (user === undefined) return;
    if (user === null && route !== '/') navigate('/');
    if (user && route === '/') navigate(landingRoute(user));
  }, [user, route, navigate]);

  const signOut = useCallback(() => {
    api
      .signOut()
      .catch(() => undefined)
      .then(() => {
        setUser(null);
        navigate('/');
      });
  }, [navigate]);

  const state = useMemo<AppState | null>(
    () => (user ? { user, status, statusTick, visibilityTick, navigate, path } : null),
    [user, status, statusTick, visibilityTick, navigate, path],
  );

  if (user === undefined) {
    return (
      <main className="centred">
        <p className="loading">Opening the stand desk</p>
      </main>
    );
  }

  if (!user || route === '/') {
    return <SignIn onSignedIn={(signedIn) => {
      setUser(signedIn);
      navigate(landingRoute(signedIn));
    }} />;
  }

  if (!state) return <SignIn onSignedIn={setUser} />;

  const librarian = user.role === 'principal_librarian' || user.role === 'assistant_librarian';
  const segments = route.split('/').filter((segment) => segment !== '');

  return (
    <AppContext.Provider value={state}>
      <div className="app">
        <header className="app-bar">
          <span className="product">Quirewell Stand Desk</span>
          <nav aria-label="Library">
            {librarian ? (
              <>
                <NavLink to="/desk" label="Programme desk" current={segments[0] === 'desk'} />
                <NavLink to="/rentals" label="Rentals" current={segments[0] === 'rentals'} />
              </>
            ) : null}
            {user.role === 'section_principal' ? (
              <NavLink to="/section" label="Section desk" current={segments[0] === 'section'} />
            ) : null}
            {user.role === 'player' || user.role === 'section_principal' ? (
              <NavLink to="/folder" label="Folders" current={segments[0] === 'folder'} />
            ) : null}
            <button type="button" className="plain" onClick={signOut}>
              Sign out
            </button>
          </nav>
          <span className="signed-in-as mono">{user.name}</span>
        </header>

        {(librarian || user.role === 'section_principal') && status.storage === 'down' ? (
          <div role="alert" className="banner">
            {STORE_OFFLINE_BANNER}
          </div>
        ) : null}
        {librarian && status.mail === 'down' ? (
          <div role="alert" className="banner">
            {MAIL_OFFLINE_BANNER}
          </div>
        ) : null}

        <Screen route={route} segments={segments} user={user} />
      </div>
    </AppContext.Provider>
  );
}

function NavLink({ to, label, current }: { to: string; label: string; current: boolean }): JSX.Element {
  const { navigate } = useApp();
  return (
    <a
      href={to}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {label}
    </a>
  );
}

function Screen({
  route,
  segments,
  user,
}: {
  route: string;
  segments: string[];
  user: User;
}): JSX.Element {
  const librarian = user.role === 'principal_librarian' || user.role === 'assistant_librarian';
  const head = segments[0];

  if (head === 'desk' && librarian) return <Desk programmeId={segments[1] ?? null} />;
  if (head === 'rentals' && librarian) return <Rentals />;
  if (head === 'section' && user.role === 'section_principal') return <SectionDesk />;
  if (head === 'folder' && (user.role === 'player' || user.role === 'section_principal')) {
    const programmeId = segments[1];
    if (programmeId === undefined) return <FolderList />;
    return <FolderScreen programmeId={programmeId} partId={segments[2] ?? null} />;
  }
  return (
    <main className="centred">
      <h1>That page isn't here.</h1>
      <p>
        <a href={landingRoute(user)}>Back to your screen</a>
      </p>
      <span className="hidden">{route}</span>
    </main>
  );
}
