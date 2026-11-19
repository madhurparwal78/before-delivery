import { useState, useEffect, useCallback } from 'react';
import type { MeJson, UserJson } from '../../../shared/types';
import { api } from './api';

export interface Session {
  me: MeJson;
  signOut: () => Promise<void>;
}
export type SessionState = Session | 'loading' | 'signed-out';

export function useSession(): SessionState {
  const [me, setMe] = useState<MeJson | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'signed-out'>('loading');

  const refresh = useCallback(async (): Promise<MeJson | null> => {
    try {
      const next = await api.me();
      setMe(next);
      setState('ready');
      return next;
    } catch {
      setMe(null);
      setState('signed-out');
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.signOut();
    setMe(null);
    setState('signed-out');
  }, []);

  if (state === 'loading') return 'loading';
  if (state === 'signed-out' || me === null) return 'signed-out';
  return { me, signOut };
}

export function userHome(user: UserJson | { role: 'bookkeeper' | 'owner' }): string {
  return user.role === 'bookkeeper' ? '/today' : '/home';
}
