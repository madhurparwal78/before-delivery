import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiGet, apiSend } from './api.js';
import type { Account } from '../../shared/types.js';

interface SessionValue {
  account: Account | null;
  loaded: boolean;
  setAccount: (account: Account | null) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [account, setAccount] = useState<Account | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void apiGet<Account>('/api/me')
      .then((found) => {
        if (active) {
          setAccount(found);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(async () => {
    await apiSend('POST', '/api/auth/signout').catch(() => undefined);
    setAccount(null);
  }, []);

  const value = useMemo(() => ({ account, loaded, setAccount, signOut }), [account, loaded, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('Session is not mounted');
  }
  return value;
}

/** Where sign in and sign up land when no return page applies. */
export function homePathFor(account: Account): string {
  if (account.role === 'follower' || account.workspaces.length === 0) {
    return '/explore';
  }
  return `/w/${account.workspaces[0].slug}`;
}
