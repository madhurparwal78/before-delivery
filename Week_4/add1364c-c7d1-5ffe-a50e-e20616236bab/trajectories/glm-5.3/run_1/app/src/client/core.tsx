import { StrictMode, useEffect, useState, useRef, useCallback, createContext, useContext, useMemo, type ReactNode } from 'react';
import { api, ApiError, type Person, type Vault, type Credential, type ClockAnswer, type AsOfAnswer, type Rule } from './api.js';
import { Drawer } from './drawer.js';
import {
  Rotations,
  Reviews,
  People,
  MyTravel,
  Billing,
  HealthReport,
  Import,
  Audit
} from './screens.js';

/* ------------------------------------------------------------------ */
/* App context                                                         */
/* ------------------------------------------------------------------ */

interface AppCtx {
  me: Person | null;
  clock: ClockAnswer | null;
  status: (message: string) => void;
  alert: (message: string) => void;
  statusMessage: string;
  alertMessage: string;
  refreshMe: () => Promise<void>;
  sessionEnded: boolean;
  signedOut: boolean;
}

const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

export function App(): ReactNode {
  const [route, setRoute] = useState<string>(window.location.pathname + window.location.search);
  const [me, setMe] = useState<Person | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [clock, setClock] = useState<ClockAnswer | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [sessionEnded, setSessionEnded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    const onPop = (): void => setRoute(window.location.pathname + window.location.search);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, replace = false) => {
    if (replace) {
      window.history.replaceState({}, '', to);
    } else {
      window.history.pushState({}, '', to);
    }
    setRoute(to);
    if (typeof window.scrollTo === 'function') {
      window.scrollTo(0, 0);
    }
  }, []);

  useEffect(() => {
    void api<ClockAnswer>('GET', '/api/clock').then(setClock).catch(() => undefined);
    const timer = setInterval(() => {
      void api<ClockAnswer>('GET', '/api/clock').then(setClock).catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void api<{ person: Person }>('GET', '/api/me')
      .then((answer) => {
        setMe(answer.person);
        setSignedOut(false);
      })
      .catch(() => {
        setMe(null);
      })
      .finally(() => setMeLoaded(true));
  }, [route]);

  const ctxValue: AppCtx = {
    me,
    clock,
    status: (message) => setStatusMessage(message),
    alert: (message) => setAlertMessage(message),
    statusMessage,
    alertMessage,
    refreshMe: async () => {
      try {
        const answer = await api<{ person: Person }>('GET', '/api/me');
        setMe(answer.person);
      } catch {
        setMe(null);
      }
    },
    sessionEnded,
    signedOut
  };

  return (
    <AppContext.Provider value={ctxValue}>
      <LiveRegions />
      <Router route={route} navigate={navigate} meLoaded={meLoaded} setSessionEnded={setSessionEnded} />
    </AppContext.Provider>
  );
}

function LiveRegions(): ReactNode {
  const { statusMessage, alertMessage } = useApp();
  return (
    <>
      <div role="status" aria-live="polite" aria-label="Desk status" className="live-region">
        {statusMessage}
      </div>
      <div role="alert" aria-live="assertive" aria-label="Desk alert" className="live-region">
        {alertMessage}
      </div>
    </>
  );
}

function Router(props: {
  route: string;
  navigate: (to: string, replace?: boolean) => void;
  meLoaded: boolean;
  setSessionEnded: (value: boolean) => void;
}): ReactNode {
  const { route, navigate } = props;
  const [me] = [useApp().me];
  const pathname = route.split('?')[0] ?? route;
  const query = new URLSearchParams(route.split('?')[1] ?? '');

  if (!props.meLoaded) {
    return <div className="loading">Opening the drawer</div>;
  }

  // Landing and sign-in are public.
  if (pathname === '/') return <Landing navigate={navigate} />;
  if (pathname === '/sign-in') return <SignIn navigate={navigate} next={query.get('next') ?? undefined} />;

  if (!me) {
    // A signed-out visit to a desk route goes to sign-in with next.
    const target = `/sign-in?next=${encodeURIComponent(route)}`;
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState({}, '', target);
    }
    return <SignIn navigate={navigate} next={route} />;
  }

  const role = me.role;
  if (pathname === '/desk' || pathname.startsWith('/desk/vaults/')) {
    return <Drawer navigate={navigate} route={route} />;
  }
  if (pathname === '/rotations' && (role === 'office_manager' || role === 'managing_partner')) {
    return <Rotations navigate={navigate} month={query.get('month') ?? ''} />;
  }
  if (pathname === '/reviews' && (role === 'office_manager' || role === 'managing_partner')) {
    return <Reviews navigate={navigate} />;
  }
  if (pathname === '/people' && (role === 'office_manager' || role === 'managing_partner')) {
    return <People navigate={navigate} />;
  }
  if (pathname === '/travel' && (role === 'staff_accountant' || role === 'outside_bookkeeper')) {
    return <MyTravel navigate={navigate} />;
  }
  if (pathname === '/billing' && (role === 'office_manager' || role === 'managing_partner')) {
    return <Billing />;
  }
  if (pathname === '/health' && (role === 'office_manager' || role === 'managing_partner')) {
    return <HealthReport />;
  }
  if (pathname === '/import' && role === 'office_manager') {
    return <Import />;
  }
  if (pathname === '/audit' && (role === 'office_manager' || role === 'managing_partner')) {
    return <Audit navigate={navigate} day={query.get('day') ?? ''} />;
  }
  return <NotFound navigate={navigate} />;
}

/* ------------------------------------------------------------------ */
/* Landing                                                             */
/* ------------------------------------------------------------------ */

function Landing(props: { navigate: (to: string, replace?: boolean) => void }): ReactNode {
  const folders = ['Payroll', 'Banking', 'Hosting', 'Vendor portals', 'Office'];
  const tones = ['tab-paper', 'tab-surface', 'tab-muted', 'tab-paper', 'tab-surface'];
  return (
    <div className="hero">
      <div className="toprow">
        <span className="wordmark">Wardhouse</span>
        <a className="signin" href="/sign-in">Sign in</a>
      </div>
      <h1 className="headline">KEYS KEPT HERE</h1>
      <p className="sentence">One drawer for every login the office shares, who holds it, and when it turns.</p>
      <div className="folders">
        <ul className="hero-folders" aria-label="Drawer folders">
          {folders.map((folder, index) => (
            <li key={folder} className={`hero-folder ${tones[index]}`}>
              {index === 0 ? (
                <a
                  href="/desk"
                  className="open-drawer solid"
                  onClick={(event) => {
                    event.preventDefault();
                    props.navigate('/desk');
                  }}
                >
                  Open the drawer
                </a>
              ) : (
                <span className="label">{folder}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className="hero-folder-labels" aria-hidden="true">
        {folders.filter((_, index) => index > 0).join(' · ')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sign in                                                             */
/* ------------------------------------------------------------------ */

function SignIn(props: { navigate: (to: string, replace?: boolean) => void; next?: string }): ReactNode {
  const { alert } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  const submit = async (): Promise<void> => {
    if (pending) return;
    setPending(true);
    try {
      const answer = await api<{ landing: string }>('POST', '/api/sessions', {
        username,
        password,
        next: props.next
      });
      props.navigate(answer.landing);
    } catch (error) {
      if (error instanceof ApiError) {
        alert(error.message);
        usernameRef.current?.focus();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="sign-in">
      <div className="paper slip form-slip">
        <h1>Sign in</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            Username
            <input
              ref={usernameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="solid">{pending ? 'Signing in' : 'Sign in'}</button>
        </form>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Not found and session ended                                         */
/* ------------------------------------------------------------------ */

function NotFound(props: { navigate: (to: string, replace?: boolean) => void }): ReactNode {
  return (
    <main className="not-found">
      <div className="paper slip">
        <h1>Nothing in this drawer</h1>
        <a
          href="/desk"
          onClick={(event) => {
            event.preventDefault();
            props.navigate('/desk');
          }}
        >
          Drawer
        </a>
      </div>
    </main>
  );
}

function SessionEnded(props: { navigate: (to: string, replace?: boolean) => void; next: string }): ReactNode {
  return (
    <main className="session-ended">
      <div className="paper slip">
        <h1>Your reveal session has ended</h1>
        <p>Sign in again to reveal logins.</p>
        <a
          href={`/sign-in?next=${encodeURIComponent(props.next)}`}
          onClick={(event) => {
            event.preventDefault();
            props.navigate(`/sign-in?next=${encodeURIComponent(props.next)}`);
          }}
        >
          Sign in
        </a>
      </div>
    </main>
  );
}
