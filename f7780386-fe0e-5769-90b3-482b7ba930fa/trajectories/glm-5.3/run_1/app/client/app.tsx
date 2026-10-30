// App shell: routing, the top bar with role navigation, the two live regions
// and the sign-in screen. Every screen renders inside this frame.

import { StrictMode, createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { getKitchen, getMe, signIn, signOut, setUnauthorizedHandler } from './api';
import type { Kitchen, User } from '../shared/types';
import { BoardScreen } from './board';
import { HoursScreen, DocumentsScreen, InvoicesScreen, ShiftsScreen, ReviewScreen, MembersScreen, UsageScreen, PacketsScreen } from './screens';
import { PacketScreen } from './packet';

// ---------------------------------------------------------------------------
// Live regions and the session.
// ---------------------------------------------------------------------------

interface Feedback {
  updates: string;
  problems: string;
  setUpdates(text: string): void;
  setProblems(text: string): void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('missing feedback provider');
  return ctx;
}

interface Session {
  user: User;
  kitchen: Kitchen;
  reload(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('missing session');
  return ctx;
}

// ---------------------------------------------------------------------------
// Routing.
// ---------------------------------------------------------------------------

function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setPath(to);
  }, []);
  return [path, navigate];
}

function homeFor(user: User): string {
  if (user.role === 'member') return '/board';
  if (user.role === 'crew_cook') return '/shifts';
  return '/review';
}

const NAV: Record<User['role'], [string, string][]> = {
  member: [
    ['Board', '/board'],
    ['Hours', '/hours'],
    ['Documents', '/documents'],
    ['Invoices', '/invoices'],
  ],
  crew_cook: [
    ['Shifts', '/shifts'],
    ['Board', '/board'],
    ['Documents', '/documents'],
  ],
  operator: [
    ['Review', '/review'],
    ['Board', '/board'],
    ['Members', '/members'],
    ['Usage', '/usage'],
    ['Packets', '/packets'],
  ],
};

// ---------------------------------------------------------------------------
// The shell.
// ---------------------------------------------------------------------------

function TopBar({ user, path, navigate }: { user: User; path: string; navigate: (to: string) => void }) {
  const { setUpdates, setProblems } = useFeedback();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSignOut = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    setUpdates('');
    setProblems('');
    navigate('/signin');
    window.location.reload();
  };

  return (
    <header className="topbar">
      <span className="kitchen">Halsted Street Kitchen</span>
      <button
        type="button"
        className="menu-button ghost"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        Menu
      </button>
      <nav aria-label="Main" className={`mainnav${menuOpen ? ' open' : ''}`}>
        {NAV[user.role].map(([label, href]) => (
          <a key={href} href={href} aria-current={path === href ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setMenuOpen(false); navigate(href); }}>
            {label}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      <span className="who">{user.name}</span>
      <button type="button" onClick={onSignOut} disabled={busy}>
        Sign out
      </button>
    </header>
  );
}

function App() {
  const [user, setUser] = useState<User | null | 'loading'>('loading');
  const [kitchen, setKitchen] = useState<Kitchen | null>(null);
  const [updates, setUpdates] = useState('');
  const [problems, setProblems] = useState('');
  const [path, navigate] = usePath();

  const feedback = useMemo<Feedback>(() => ({ updates, problems, setUpdates, setProblems }), [updates, problems]);

  const loadSession = useCallback(async () => {
    const me = await getMe();
    if (me.ok && me.body) {
      setUser(me.body.user);
      const kitchenRes = await getKitchen();
      if (kitchenRes.ok && kitchenRes.body) setKitchen(kitchenRes.body);
    } else if (me.status === 401) {
      setUser(null);
    } else {
      setUser(null);
      setProblems('Passboard could not reach the server. Nothing changed; try again.');
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // Any request answered 401 returns to sign in — except on the public
  // packet page, which is read without signing in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (window.location.pathname.startsWith('/packet/')) return;
      setUser(null);
      setProblems('Your session ended. Sign in again.');
      navigate('/signin');
    });
  }, [navigate]);

  if (user === 'loading' || (user && !kitchen)) {
    return <p className="hint" style={{ padding: 12 }}>Loading…</p>;
  }

  if (user === null) {
    const isPacketPage = path.startsWith('/packet/');
    if (isPacketPage) {
      return (
        <FeedbackContext.Provider value={feedback}>
          <PacketScreen token={path.slice('/packet/'.length)} signedOut />
        </FeedbackContext.Provider>
      );
    }
    return (
      <FeedbackContext.Provider value={feedback}>
        <SignInScreen
          onSignedIn={(u) => {
            setUser(u);
            void getKitchen().then((r) => r.ok && r.body && setKitchen(r.body));
            navigate(homeFor(u));
          }}
        />
      </FeedbackContext.Provider>
    );
  }

  const session: Session = { user, kitchen: kitchen!, reload: loadSession };

  let screen = <BoardScreen />;
  if (path === '/hours') screen = <HoursScreen />;
  else if (path === '/documents') screen = <DocumentsScreen />;
  else if (path === '/invoices') screen = <InvoicesScreen />;
  else if (path === '/shifts') screen = <ShiftsScreen />;
  else if (path === '/review') screen = <ReviewScreen />;
  else if (path === '/members') screen = <MembersScreen />;
  else if (path === '/usage') screen = <UsageScreen />;
  else if (path === '/packets') screen = <PacketsScreen />;
  else if (path.startsWith('/packet/')) screen = <PacketScreen token={path.slice('/packet/'.length)} />;
  else if (path === '/signin') {
    window.history.replaceState(null, '', homeFor(user));
  }

  return (
    <>
      <a href="#board" className="visually-hidden">Skip to the board</a>
      <FeedbackContext.Provider value={feedback}>
      <SessionContext.Provider value={session}>
        <TopBar user={user} path={path} navigate={navigate} />
        <p className="updates" role="status" aria-live="polite" aria-label="Updates">{updates}</p>
        <p className="problems" role="alert" aria-label="Problems">{problems}</p>
        <main>{screen}</main>
      </SessionContext.Provider>
    </FeedbackContext.Provider>
    </>
  );
}

function SignInScreen({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { setUpdates, setProblems } = useFeedback();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setUpdates('Signing in…');
    setProblems('');
    const res = await signIn(email, password);
    setBusy(false);
    if (res.ok && res.body) {
      setUpdates('');
      onSignedIn(res.body.user);
    } else if (res.status === 401) {
      setProblems('Email or password is wrong.');
      setUpdates('');
    } else if (res.status === 0) {
      setProblems('Passboard could not reach the server. Nothing changed; try again.');
      setUpdates('');
    } else {
      setProblems('Email or password is wrong.');
      setUpdates('');
    }
  };

  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', padding: 12 }}>
      <h1>Sign in to Passboard</h1>
      <form aria-label="Sign in" onSubmit={submit} className="stack">
        <label>
          Email
          <input type="text" name="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" name="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <button type="submit" disabled={busy}>Sign in</button>
      </form>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
