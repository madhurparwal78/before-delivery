import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Account, Auth } from '../shared/api';
import { apiPath, request } from './api';
import { OUTAGE_COPY } from './copy';

// The signed-in account, kept across reloads, and the Account messages line.

const AUTH_KEY = 'keel-outpost.auth';

export type Viewer = 'visitor' | 'attendee' | 'organiser';

interface AppValue {
  auth: Auth | null;
  viewer: Viewer;
  accountMessage: string;
  setAccountMessage: (message: string) => void;
  signedIn: (auth: Auth, message: string) => void;
  signOut: () => Promise<void>;
  dropAuth: () => void;
}

const AppContext = createContext<AppValue | null>(null);

function isAccount(value: unknown): value is Account {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'email' in value &&
    typeof value.email === 'string' &&
    'role' in value &&
    (value.role === 'attendee' || value.role === 'organiser')
  );
}

function storedAuth(): Auth | null {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(AUTH_KEY) ?? 'null');
    if (typeof parsed === 'object' && parsed !== null && 'token' in parsed && typeof parsed.token === 'string' && 'account' in parsed && isAccount(parsed.account)) {
      return { token: parsed.token, account: parsed.account };
    }
  } catch {
    return null;
  }
  return null;
}

function store(auth: Auth | null): void {
  if (auth) window.localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else window.localStorage.removeItem(AUTH_KEY);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Auth | null>(storedAuth);
  const [accountMessage, setAccountMessage] = useState('');

  const dropAuth = useCallback(() => {
    store(null);
    setAuth(null);
  }, []);

  const signedIn = useCallback((next: Auth, message: string) => {
    store(next);
    setAuth(next);
    setAccountMessage(message);
  }, []);

  const signOut = useCallback(async () => {
    if (!auth) return;
    setAccountMessage('Signing out…');
    const result = await request<{ signed_out: boolean }>(apiPath('/auth/logout'), { method: 'POST', token: auth.token });
    if (!result.ok && result.error.code === 'unavailable') {
      setAccountMessage(OUTAGE_COPY);
      return;
    }
    store(null);
    setAuth(null);
    setAccountMessage('You are signed out.');
  }, [auth]);

  // The stored token is checked once per load; a signed-out or unknown token is forgotten.
  const token = auth?.token ?? null;
  useEffect(() => {
    if (!token) return;
    let live = true;
    void request<Account>(apiPath('/me'), { token }).then((result) => {
      if (!live) return;
      if (result.ok) {
        const next = { token, account: result.data };
        store(next);
        setAuth(next);
      } else if (result.error.code === 'unauthenticated') {
        dropAuth();
      }
    });
    return () => {
      live = false;
    };
  }, [token, dropAuth]);

  const value = useMemo<AppValue>(
    () => ({
      auth,
      viewer: auth ? auth.account.role : 'visitor',
      accountMessage,
      setAccountMessage,
      signedIn,
      signOut,
      dropAuth,
    }),
    [auth, accountMessage, signedIn, signOut, dropAuth],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp outside AppProvider');
  return value;
}
