import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiErrorBody, SESSION_ENDED, api } from './api';
import { matchAppRoute, RouteMatch } from '../../src/shared/routes';
import { Role, copy } from './types';

/* Routing */

interface RouterValue {
  path: string;
  search: string;
  match: RouteMatch | null;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));
  useEffect(() => {
    const onPop = (): void =>
      setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setLocation({ path: url.pathname, search: url.search });
  }, []);
  const value = useMemo<RouterValue>(
    () => ({
      path: location.path,
      search: location.search,
      match: matchAppRoute(location.path),
      navigate,
    }),
    [location, navigate],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('Router is missing');
  return value;
}

export function Link({
  to,
  children,
  className,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
} & Record<string, unknown>): JSX.Element {
  const { navigate, path } = useRouter();
  return (
    <a
      href={to}
      className={className}
      {...(path === to ? { 'aria-current': 'page' } : {})}
      {...rest}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/* Session */

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
}

interface SessionValue {
  user: SessionUser | null;
  home: string | null;
  ready: boolean;
  signIn: (user: SessionUser, home: string) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const result = await api<{ user: SessionUser; home: string }>('/api/session');
    if (result.data) {
      setUser(result.data.user);
      setHome(result.data.home);
    } else {
      setUser(null);
      setHome(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      user,
      home,
      ready,
      signIn: (nextUser, nextHome) => {
        setUser(nextUser);
        setHome(nextHome);
      },
      signOut: async () => {
        await api('/api/session', { method: 'DELETE' });
        setUser(null);
        setHome(null);
      },
      refresh,
    }),
    [user, home, ready, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('Session is missing');
  return value;
}

/* Announcements and problems */

interface AnnounceValue {
  message: string;
  sessionEnded: boolean;
  announce: (message: string) => void;
  working: () => void;
  clearSessionEnded: () => void;
}

const AnnounceContext = createContext<AnnounceValue | null>(null);

export function AnnounceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [message, setMessage] = useState('');
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => {
    const onEnded = (): void => {
      setSessionEnded(true);
      setMessage(copy.sessionEnded);
      window.sessionStorage.setItem(
        'ocotillo:resume',
        `${window.location.pathname}${window.location.search}`,
      );
    };
    window.addEventListener(SESSION_ENDED, onEnded);
    return () => window.removeEventListener(SESSION_ENDED, onEnded);
  }, []);
  const value = useMemo<AnnounceValue>(
    () => ({
      message,
      sessionEnded,
      announce: setMessage,
      working: () => setMessage(copy.working),
      clearSessionEnded: () => setSessionEnded(false),
    }),
    [message, sessionEnded],
  );
  return <AnnounceContext.Provider value={value}>{children}</AnnounceContext.Provider>;
}

export function useAnnounce(): AnnounceValue {
  const value = useContext(AnnounceContext);
  if (!value) throw new Error('Announcements are missing');
  return value;
}

export function Announcements(): JSX.Element {
  const { message, sessionEnded } = useAnnounce();
  return (
    <div className="announcements" role="status" aria-live="polite" aria-label="Announcements">
      {message === '' ? null : <p>{message}</p>}
      {sessionEnded ? <Link to="/signin">Sign in again</Link> : null}
    </div>
  );
}

export function Problems({
  fields,
  message,
}: {
  fields?: Record<string, string>;
  message?: string | null;
}): JSX.Element | null {
  const entries = Object.entries(fields ?? {});
  if (entries.length === 0 && !message) return null;
  return (
    <div className="problems" role="region" aria-label="Problems" tabIndex={-1} id="problems">
      {message ? <p>{message}</p> : null}
      {entries.length > 0 ? (
        <ul>
          {entries.map(([field, text]) => (
            <li key={field}>
              <a
                href={`#field-${field}`}
                onClick={(event) => {
                  event.preventDefault();
                  const target = document.getElementById(`field-${field}`);
                  target?.focus();
                }}
              >
                {text}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function focusProblems(): void {
  window.requestAnimationFrame(() => {
    document.getElementById('problems')?.focus();
  });
}

/* Live data */

export function useLive<T>(
  load: () => Promise<T | null>,
  deps: unknown[] = [],
): { data: T | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    const run = async (): Promise<void> => {
      const next = await loader.current();
      if (live && next !== null) setData(next);
    };
    void run();
    const timer = window.setInterval(() => void run(), 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, reload: () => setTick((value) => value + 1) };
}

export function useFieldErrors(): {
  fields: Record<string, string>;
  message: string | null;
  show: (error: ApiErrorBody | null) => void;
  clear: () => void;
} {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  return {
    fields,
    message,
    show: (error) => {
      setFields(error?.fields ?? {});
      setMessage(error && !error.fields ? error.message : null);
    },
    clear: () => {
      setFields({});
      setMessage(null);
    },
  };
}

/** State that survives a sign-in round trip, so a form keeps what was typed. */
export function useRemembered<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `ocotillo:form:${key}`;
  const [value, setValue] = useState<T>(() => {
    const stored = window.sessionStorage.getItem(storageKey);
    if (stored === null) return initial;
    try {
      return JSON.parse(stored) as T;
    } catch {
      return initial;
    }
  });
  return [
    value,
    (next: T) => {
      setValue(next);
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
    },
  ];
}

export function forgetRemembered(key: string): void {
  window.sessionStorage.removeItem(`ocotillo:form:${key}`);
}

/** The server's clock, read from its own response, so a wrong device clock changes nothing. */
export function useServerDate(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let live = true;
    const read = async (): Promise<void> => {
      const response = await fetch('/api/health', { credentials: 'same-origin' });
      const stamp = response.headers.get('Date');
      if (live && stamp) setNow(new Date(stamp));
    };
    void read();
    const timer = window.setInterval(() => void read(), 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
