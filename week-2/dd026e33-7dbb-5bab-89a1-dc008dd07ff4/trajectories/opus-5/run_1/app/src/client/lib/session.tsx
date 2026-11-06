import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MeResponse, User } from '../../shared/types';
import { DEFAULT_UNITS, type UnitSettings } from '../../shared/units';
import { SignInAgainDialog } from '../components/SignInAgainDialog';
import { api, onSessionFault } from './api';
import { navigate } from './router';

/** An action interrupted by the session expiry: resent once, or told it was not saved. */
export interface InterruptedAction {
  readonly resend: (() => void) | null;
  readonly notResent: (() => void) | null;
}

interface SessionState {
  readonly user: User | null;
  readonly units: UnitSettings;
  readonly ready: boolean;
  readonly signInAgainOpen: boolean;
  readonly revokedNotice: boolean;
  setUnits(units: UnitSettings): void;
  setUser(user: User | null): void;
  markInterrupted(action: InterruptedAction): void;
  clearRevokedNotice(): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('Session is not ready');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<User | null>(null);
  const [units, setUnits] = useState<UnitSettings>(DEFAULT_UNITS);
  const [ready, setReady] = useState(false);
  const [signInAgainOpen, setSignInAgainOpen] = useState(false);
  const [revokedNotice, setRevokedNotice] = useState(false);
  const interrupted = useRef<InterruptedAction[]>([]);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api<MeResponse>('/api/me').then((outcome) => {
      if (cancelled) return;
      if (outcome.kind === 'ok') {
        setUser(outcome.body.user);
        setUnits(outcome.body.units);
      }
      readyRef.current = true;
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return onSessionFault((fault) => {
      if (fault === 'session_expired') {
        if (!readyRef.current) {
          navigate(
            `/sign-in?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`,
            { replace: true },
          );
          return;
        }
        setSignInAgainOpen(true);
        return;
      }
      if (!readyRef.current) {
        const next = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
        setRevokedNotice(fault === 'access_revoked');
        navigate(`/sign-in?next=${next}`, { replace: true });
        return;
      }
      setRevokedNotice(fault === 'access_revoked');
      setUser(null);
      navigate('/sign-in', { replace: true });
    });
  }, []);

  const markInterrupted = useCallback((action: InterruptedAction) => {
    interrupted.current.push(action);
  }, []);

  const onSignedInAgain = useCallback(() => {
    const pending = interrupted.current;
    interrupted.current = [];
    setSignInAgainOpen(false);
    for (const action of pending) {
      if (action.resend !== null) action.resend();
      else action.notResent?.();
    }
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      user,
      units,
      ready,
      signInAgainOpen,
      revokedNotice,
      setUnits,
      setUser,
      markInterrupted,
      clearRevokedNotice: () => setRevokedNotice(false),
    }),
    [user, units, ready, signInAgainOpen, revokedNotice, markInterrupted],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {signInAgainOpen ? (
        <SignInAgainDialog email={user?.email ?? ''} onSignedIn={onSignedInAgain} />
      ) : null}
    </SessionContext.Provider>
  );
}
