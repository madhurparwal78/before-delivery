import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ProviderStatus, Ride, User } from '../shared/types.js';
import { ApiError, get, post, setSignInAsker } from './api.js';
import { Panel } from './components/Panel.js';
import { navigate } from './router.js';
import { usePoll } from './hooks.js';

interface Session {
  user: User | null;
  ready: boolean;
  signedIn: (user: User) => void;
  signOut: () => Promise<void>;
  providers: Pick<ProviderStatus, 'killbill' | 'registry'>;
  /** The shop's Amsterdam date, from the server clock. */
  today: string;
}

const SessionContext = createContext<Session | null>(null);
export const useSession = (): Session => useContext(SessionContext)!;

const amsterdamDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });

export const RESUME_KEY = 'resume-configuration';

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [providers, setProviders] = useState<Session['providers']>({ killbill: 'up', registry: 'up' });
  const [today, setToday] = useState('');
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  useEffect(() => {
    get<User>('/api/me', { poll: true }).then(setUser, () => setUser(null)).finally(() => setReady(true));
  }, []);

  usePoll(async () => {
    const status = await get<ProviderStatus>('/api/status', { poll: true });
    setProviders((was) => (was.killbill === status.killbill && was.registry === status.registry ? was : { killbill: status.killbill, registry: status.registry }));
    setToday(amsterdamDate.format(new Date(status.serverNow)));
  }, 2000, []);

  const signOut = useCallback(async () => {
    await post('/api/auth/sign-out');
    setUser(null);
    navigate('/');
  }, []);

  const value = useMemo<Session>(() => ({ user, ready, signedIn: setUser, signOut, providers, today }), [user, ready, signOut, providers, today]);
  return (
    <SessionContext.Provider value={value}>
      {children}
      <SignInAgain emailOf={() => userRef.current?.email ?? ''} onSignedIn={setUser} />
    </SessionContext.Provider>
  );
}

/** The dialog over the page when an action finds the session over. It keeps the page, its address and every typed value. */
function SignInAgain({ emailOf, onSignedIn }: { emailOf: () => string; onSignedIn: (user: User) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const waiting = useRef<((signedIn: boolean) => void) | null>(null);

  useEffect(() => {
    setSignInAsker(() => new Promise<boolean>((resolve) => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      waiting.current?.(false);
      waiting.current = resolve;
      setEmail(emailOf());
      setPassword('');
      setError('');
      setOpen(true);
    }));
  }, [emailOf]);

  const finish = (signedIn: boolean): void => {
    setOpen(false);
    waiting.current?.(signedIn);
    waiting.current = null;
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      const user = await post<User>('/api/auth/sign-in', { email, password }, { poll: true });
      onSignedIn(user);
      opener.current?.focus();
      finish(true);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 401 ? 'Email or password is wrong.' : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel open={open} name="Sign in again" variant="modal" opener={() => opener.current} onClose={() => finish(false)}>
      <form className="stack" onSubmit={(event) => { void submit(event); }} aria-label="Sign in again form">
        <h2>Sign in again</h2>
        <p>Your session ended. Sign in to carry on.</p>
        <label className="field"><span>Email</span>
          <input type="email" role="textbox" value={email} readOnly autoComplete="username" />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" role="textbox" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <div className="row-actions">
          <button type="submit" className="btn primary" aria-busy={busy}>Sign in</button>
        </div>
      </form>
    </Panel>
  );
}

// ---- the test-ride hold, shown in the header of a signed-in rider --------------------------------------------------------------

interface Hold {
  /** The live hold, if any. */
  ride: Ride | null;
  seconds: number;
  message: string;
  announce: (message: string) => void;
  reload: () => Promise<void>;
}

const HoldContext = createContext<Hold | null>(null);
export const useHold = (): Hold => useContext(HoldContext)!;

export function HoldProvider({ children }: { children: ReactNode }): ReactNode {
  const { user } = useSession();
  const [ride, setRide] = useState<Ride | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const lastMinutes = useRef(0);
  const heldId = useRef('');

  const reload = useCallback(async () => {
    const { rides } = await get<{ rides: Ride[] }>('/api/test-rides', { poll: true });
    const live = rides.find((r) => r.state === 'held') ?? null;
    if (live) {
      heldId.current = live.id;
      setSeconds(live.remainingSeconds);
      const minutes = Math.ceil(live.remainingSeconds / 60);
      if (minutes !== lastMinutes.current) {
        lastMinutes.current = minutes;
        setMessage(`Hold ends in ${minutes} min.`);
      }
    } else if (heldId.current) {
      const was = rides.find((r) => r.id === heldId.current);
      heldId.current = '';
      lastMinutes.current = 0;
      setMessage(was?.state === 'expired' ? 'Your hold ran out. The slot is free again.' : '');
    }
    setRide((prev) => (prev?.id === live?.id && prev?.state === live?.state ? prev : live));
  }, []);

  usePoll(async () => { if (user?.role === 'rider') await reload(); }, 2000, [user?.id]);

  useEffect(() => {
    if (!ride) return undefined;
    const timer = window.setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          void reload();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ride, reload]);

  const value = useMemo<Hold>(() => ({ ride, seconds, message, announce: setMessage, reload }), [ride, seconds, message, reload]);
  return <HoldContext.Provider value={value}>{children}</HoldContext.Provider>;
}
