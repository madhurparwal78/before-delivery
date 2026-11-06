// The signed-in device session, the home clock and the theme, shared by every screen.
import { useSyncExternalStore } from 'react';
import type { ThemeName } from '../shared/tokens.ts';
import type { SessionJson } from './types.ts';

interface SessionState { session: SessionJson | null; zone: string; theme: ThemeName }

let state: SessionState = { session: null, zone: 'Europe/London', theme: 'paper' };
const listeners = new Set<() => void>();

function set(patch: Partial<SessionState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function setSession(session: SessionJson): void {
  set({ session, zone: session.home_time_zone, theme: session.theme });
  applyTheme(session.theme);
}

export function setZone(zone: string): void {
  set({ zone });
}

export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  if (state.theme !== theme) set({ theme });
}

export function useSession(): SessionState {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, () => state);
}
