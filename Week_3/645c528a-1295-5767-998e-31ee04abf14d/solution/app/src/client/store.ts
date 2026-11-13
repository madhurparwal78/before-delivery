/** Session state shared by every screen: the player, connection state, settings and last-seen chip values. */
import { useSyncExternalStore } from 'react';
import { api, ApiFailure, type Me, type Settings } from './api';
import { connectLive, disconnectLive, subscribe } from './live';

export type AuthState = 'loading' | 'guest' | 'player';

export interface Store {
  auth: AuthState;
  me: Me | null;
  outage: boolean;
  online: boolean;
  settings: Settings;
}

const ME_KEY = 'hs_me';
const SETTINGS_KEY = 'hs_settings';
export const TUTORIAL_KEY = 'hs_tutorial_done';

const DEFAULT_SETTINGS: Settings = { sound: true, music: false, aimSensitivity: 5, leftHanded: false, reducedMotion: false, theme: 'dark' };

function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

let state: Store = {
  auth: 'loading',
  me: readJson<Me>(ME_KEY),
  outage: false,
  online: navigator.onLine,
  settings: { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(SETTINGS_KEY) },
};

const listeners = new Set<() => void>();
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyDocumentSettings(): void {
  const { theme, reducedMotion } = state.settings;
  const root = document.documentElement;
  root.dataset.theme = theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme;
  root.dataset.motion = reducedMotion || reducedQuery.matches ? 'reduce' : 'full';
}

function update(partial: Partial<Store>): void {
  state = { ...state, ...partial };
  applyDocumentSettings();
  listeners.forEach((listener) => listener());
}

export function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === 'reduce';
}

export function useStore(): Store {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => state);
}

export function currentStore(): Store {
  return state;
}

function adoptPlayer(me: Me): void {
  localStorage.setItem(ME_KEY, JSON.stringify(me));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(me.settings));
  update({ auth: 'player', me, outage: false, settings: me.settings });
  connectLive();
}

function becomeGuest(): void {
  localStorage.removeItem(ME_KEY);
  disconnectLive();
  update({ auth: 'guest', me: null, outage: false });
}

export async function refreshMe(): Promise<void> {
  try {
    adoptPlayer(await api<Me>('GET', '/api/me'));
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 401) {
      becomeGuest();
      return;
    }
    const known = state.me !== null || (error instanceof ApiFailure && error.status === 503);
    update({ auth: known ? 'player' : 'guest', outage: state.online });
  }
}

export async function changeSettings(changes: Partial<Settings>): Promise<void> {
  const settings = { ...state.settings, ...changes };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  update({ settings });
  if (state.auth === 'player') await api<Settings>('PATCH', '/api/me/settings', changes);
}

export async function signOut(): Promise<void> {
  await api('POST', '/api/auth/signout');
  becomeGuest();
}

export function forgetPlayer(): void {
  becomeGuest();
}

export function startStore(): void {
  applyDocumentSettings();
  reducedQuery.addEventListener('change', applyDocumentSettings);
  darkQuery.addEventListener('change', applyDocumentSettings);
  addEventListener('online', () => {
    update({ online: true });
    void refreshMe();
  });
  addEventListener('offline', () => update({ online: false }));
  subscribe('me', () => void refreshMe());
  void refreshMe();
  void navigator.serviceWorker?.register('/sw.js').catch(() => undefined);
}
