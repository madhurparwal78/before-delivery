import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_HOME } from '../shared/landing';
import type { Role, User } from '../shared/types';
import { api, ApiFailure } from './lib/api';
import { useBand } from './lib/motion';
import { SignIn } from './routes/SignIn';
import { Register } from './routes/Register';
import { ContractSheet } from './routes/ContractSheet';
import { Family } from './routes/Family';
import { Reserve } from './routes/Reserve';
import { SignAgreement } from './routes/SignAgreement';
import { PriceLists } from './routes/PriceLists';
import { Schools } from './routes/Schools';
import { Roster } from './routes/Roster';

interface Session {
  user: User | null;
  loaded: boolean;
  setUser: (user: User | null) => void;
}

const SessionContext = createContext<Session>({ user: null, loaded: false, setUser: () => undefined });

export function useSession(): Session {
  return useContext(SessionContext);
}

const NAV_LINKS: Record<Role, Array<{ to: string; label: string }>> = {
  owner: [
    { to: '/register', label: 'Register' },
    { to: '/price-lists', label: 'Price lists' },
    { to: '/schools', label: 'Schools' },
  ],
  tech: [{ to: '/register', label: 'Register' }],
  parent: [{ to: '/family', label: 'My family' }],
  director: [{ to: '/roster', label: 'Roster' }],
};

function TopBar(): ReactNode {
  const { user, setUser } = useSession();
  const band = useBand();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (band !== 'narrow') setOpen(false);
  }, [band]);

  useEffect(() => {
    if (open && firstLink.current !== null) firstLink.current.focus();
  }, [open]);

  if (user === null) return null;
  const collapsed = band === 'narrow' && !open;

  const signOut = async (): Promise<void> => {
    await api('/session', { method: 'DELETE' });
    setUser(null);
    navigate('/', { replace: true });
  };

  return (
    <header
      className="topbar"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <span className="wordmark">Keel &amp; Bell</span>
      {band === 'narrow' ? (
        <button
          type="button"
          ref={menuButton}
          aria-expanded={open ? 'true' : 'false'}
          onClick={() => setOpen((value) => !value)}
        >
          Menu
        </button>
      ) : null}
      <div className="topbar-spacer" />
      {collapsed ? null : (
        <>
          <nav aria-label="Main">
            {NAV_LINKS[user.role].map((link, index) => (
              <Link
                key={link.to}
                to={link.to}
                ref={index === 0 ? firstLink : undefined}
                className="button"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </>
      )}
    </header>
  );
}

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }): ReactNode {
  const { user, loaded } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loaded) return;
    if (user === null) {
      const next = encodeURIComponent(`${location.pathname}${location.search}`);
      navigate(`/?next=${next}`, { replace: true });
      return;
    }
    if (!roles.includes(user.role)) navigate(ROLE_HOME[user.role], { replace: true });
  }, [loaded, user, roles, location.pathname, location.search, navigate]);

  if (!loaded) return <p className="page">Loading…</p>;
  if (user === null || !roles.includes(user.role)) return <p className="page">Loading…</p>;
  return <>{children}</>;
}

export function App(): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const answer = await api<{ user: User }>('/me');
      setUser(answer.user);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) setUser(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SessionContext.Provider value={{ user, loaded, setUser }}>
      <Routes>
        <Route path="/sign/:token" element={<SignAgreement />} />
        <Route
          path="/"
          element={
            <>
              <SignIn />
            </>
          }
        />
        <Route
          path="/register"
          element={
            <>
              <TopBar />
              <Guard roles={['owner', 'tech']}>
                <Register />
              </Guard>
            </>
          }
        />
        <Route
          path="/contracts/:id"
          element={
            <>
              <TopBar />
              <Guard roles={['owner', 'tech', 'parent']}>
                <ContractSheet />
              </Guard>
            </>
          }
        />
        <Route
          path="/family"
          element={
            <>
              <TopBar />
              <Guard roles={['parent']}>
                <Family />
              </Guard>
            </>
          }
        />
        <Route
          path="/reserve"
          element={
            <>
              <TopBar />
              <Guard roles={['parent']}>
                <Reserve />
              </Guard>
            </>
          }
        />
        <Route
          path="/price-lists"
          element={
            <>
              <TopBar />
              <Guard roles={['owner']}>
                <PriceLists />
              </Guard>
            </>
          }
        />
        <Route
          path="/schools"
          element={
            <>
              <TopBar />
              <Guard roles={['owner']}>
                <Schools />
              </Guard>
            </>
          }
        />
        <Route
          path="/roster"
          element={
            <>
              <TopBar />
              <Guard roles={['director', 'owner']}>
                <Roster />
              </Guard>
            </>
          }
        />
        <Route path="*" element={<SignIn />} />
      </Routes>
    </SessionContext.Provider>
  );
}
