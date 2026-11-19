import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Role } from '../../../shared/domain';
import { ApiError, get } from './api';
import { useLive } from './live';

export interface Me {
  id: string;
  name: string;
  role: Role;
  clinic: { id: string; name: string; slug: string };
}

export interface Settings {
  slotMinutes: number;
  openMinute: number;
  closeMinute: number;
  uploadMaxMb: number;
  vatPercent: number;
}

interface Env {
  me: Me | null | undefined;
  reloadMe: () => Promise<void>;
  settings: Settings | undefined;
}

const EnvContext = createContext<Env>({ me: undefined, reloadMe: () => Promise.resolve(), settings: undefined });

export function EnvProvider({ children, onRemoved }: { children: ReactNode; onRemoved: () => void }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings>();
  const reloadMe = useCallback(
    () =>
      get<Me>('/api/me').then(setMe, (error: unknown) => {
        if (error instanceof ApiError && error.status === 401) setMe(null);
      }),
    [],
  );
  useEffect(() => {
    void reloadMe();
    get<Settings>('/api/settings').then(setSettings, () => undefined);
  }, [reloadMe]);
  useLive(['role', 'removed', 'staff'], (event) => {
    if (event.t === '*') void reloadMe();
    else if (event.t === 'removed' && event.userId === me?.id) onRemoved();
    else if (event.t === 'role' && event.userId === me?.id) void reloadMe();
  });
  return <EnvContext.Provider value={{ me, reloadMe, settings }}>{children}</EnvContext.Provider>;
}

export const useEnv = () => useContext(EnvContext);

export function useMe(): Me {
  const { me } = useContext(EnvContext);
  if (!me) throw new Error('not signed in');
  return me;
}

type Layout = 'phone' | 'tablet' | 'desktop';

const TABLET = '(min-width: 768px)';
const DESKTOP = '(min-width: 1100px)';

function layoutNow(): Layout {
  if (window.matchMedia(DESKTOP).matches) return 'desktop';
  return window.matchMedia(TABLET).matches ? 'tablet' : 'phone';
}

function subscribeMedia(query: string[], listener: () => void) {
  const lists = query.map((q) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener('change', listener));
  return () => lists.forEach((l) => l.removeEventListener('change', listener));
}

export function useLayout(): Layout {
  return useSyncExternalStore((l) => subscribeMedia([TABLET, DESKTOP], l), layoutNow);
}

const REDUCED = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (l) => subscribeMedia([REDUCED], l),
    () => window.matchMedia(REDUCED).matches,
  );
}

/** `data-motion*` attributes of a published animation; under reduced motion each reads none and 0. */
export function useMotion() {
  const reduced = useReducedMotion();
  return (name: string, ms: number, easing: string): Record<string, string> =>
    reduced ? { 'data-motion': 'none', 'data-motion-ms': '0' } : { 'data-motion': name, 'data-motion-ms': String(ms), 'data-motion-easing': easing };
}
