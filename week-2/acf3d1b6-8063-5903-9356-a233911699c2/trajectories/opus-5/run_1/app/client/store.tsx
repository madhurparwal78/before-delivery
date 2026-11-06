import { ComponentChildren, createContext } from 'preact';
import { useCallback, useContext, useEffect, useState } from 'preact/hooks';
import { api, ApiError, setToken } from './api';
import { PlanId } from '../shared/catalog';

export interface Me {
  user: { id: string; name: string; email: string; role: 'owner' | 'member' };
  workspace: { id: string; name: string; plan: PlanId };
  balance: number;
}

interface AuthValue {
  me: Me | null;
  state: 'loading' | 'signed-in' | 'signed-out';
  refresh: () => Promise<Me | null>;
  signIn: (token: string) => Promise<Me | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue>({
  me: null,
  state: 'loading',
  refresh: async () => null,
  signIn: async () => null,
  signOut: async () => undefined
});

export function AuthProvider({ children }: { children: ComponentChildren }) {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<AuthValue['state']>('loading');

  const refresh = useCallback(async () => {
    try {
      const loaded = await api<Me>('/api/me');
      setMe(loaded);
      setState('signed-in');
      return loaded;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setToken(null);
        setMe(null);
        setState('signed-out');
        return null;
      }
      throw error;
    }
  }, []);

  const signIn = useCallback(
    async (token: string) => {
      setToken(token);
      return refresh();
    },
    [refresh]
  );

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setMe(null);
    setState('signed-out');
  }, []);

  return <AuthContext.Provider value={{ me, state, refresh, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

/** Loads the signed-in member once per page view for the studio pages. */
export function useMember(): AuthValue {
  const auth = useAuth();
  useEffect(() => {
    if (auth.state === 'loading') void auth.refresh();
  }, [auth.state]);
  return auth;
}
