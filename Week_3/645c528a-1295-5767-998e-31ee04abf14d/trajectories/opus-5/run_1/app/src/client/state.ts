import { api } from './api.js';

export interface Settings {
  sound: boolean;
  music: boolean;
  aimSensitivity: number;
  leftHanded: boolean;
  reducedMotion: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  level: number;
  xp: number;
  coins: number;
  cash: number;
  emailVerified: boolean;
  minor: boolean;
  xpToNext: number;
  wins: number;
  losses: number;
  winRate: number;
  winStreak: number;
  highestPot: number;
  equippedCueId: string | null;
  equippedClothId: string | null;
  dailyRewardClaimed: boolean;
  refillsLeft: number;
  mailDelayed: boolean;
  activeTableUrl: string | null;
  friendCode: string;
  settings: Settings;
}

export interface CachedChips {
  coins: number;
  cash: number;
}

type Listener = () => void;

const listeners = new Set<Listener>();
const eventListeners = new Map<string, Set<(data: unknown) => void>>();

export const state = {
  me: null as Me | null,
  storeDown: false,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  cachedChips: null as CachedChips | null,
};

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(): void {
  for (const listener of listeners) listener();
}

export function onServerEvent(type: string, listener: (data: unknown) => void): () => void {
  const set = eventListeners.get(type) ?? new Set();
  set.add(listener);
  eventListeners.set(type, set);
  return () => set.delete(listener);
}

function emit(type: string, data: unknown): void {
  for (const listener of eventListeners.get(type) ?? []) listener(data);
}

export function readCachedChips(): CachedChips | null {
  try {
    const raw = localStorage.getItem('hs:chips');
    return raw ? (JSON.parse(raw) as CachedChips) : null;
  } catch {
    return null;
  }
}

function writeCachedChips(chips: CachedChips): void {
  store('hs:chips', JSON.stringify(chips));
}

/** Browser storage is a nicety here: the server is always the record. */
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function tutorialFinished(): boolean {
  try {
    return localStorage.getItem('hs:tutorial') === 'done';
  } catch {
    return false;
  }
}

export function markTutorialFinished(): void {
  store('hs:tutorial', 'done');
}

export async function refreshMe(): Promise<void> {
  const result = await api<Me>('GET', '/api/me');
  if (result.ok) {
    state.me = result.data;
    state.storeDown = false;
    state.cachedChips = { coins: result.data.coins, cash: result.data.cash };
    writeCachedChips(state.cachedChips);
    applySettings(result.data.settings);
  } else if (result.failure.status === 401) {
    state.me = null;
    state.storeDown = await storeUnreachable();
    if (state.storeDown) state.cachedChips = state.cachedChips ?? readCachedChips();
  } else if (result.failure.status === 503) {
    state.storeDown = true;
    state.cachedChips = state.cachedChips ?? readCachedChips();
  } else if (result.failure.status === 0) {
    state.cachedChips = state.cachedChips ?? readCachedChips();
  }
  notify();
}

/** A signed-out answer still needs the store checked, so Home can say the table is out of reach. */
async function storeUnreachable(): Promise<boolean> {
  const probe = await api<unknown>('GET', '/api/clubs');
  return !probe.ok && probe.failure.error === 'store_unavailable';
}

export function applySettings(settings: Settings): void {
  const root = document.documentElement;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  root.classList.toggle('theme-light', !dark);
  root.classList.toggle('theme-dark', dark);
  root.classList.toggle('left-handed', settings.leftHanded);
  const devicePrefers = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.classList.toggle('reduced-motion', settings.reducedMotion || devicePrefers);
}

export function applyGuestSettings(): void {
  const devicePrefers = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.toggle('reduced-motion', devicePrefers);
  document.documentElement.classList.add('theme-dark');
}

let source: EventSource | null = null;
let currentTopics = '';

export function setTopics(topics: string[]): void {
  const unique = [...new Set(topics.filter(Boolean))].sort();
  const key = unique.join(',');
  if (key === currentTopics && source) return;
  currentTopics = key;
  source?.close();
  source = null;
  if (unique.length === 0) return;
  const stream = new EventSource(`/api/events?topics=${encodeURIComponent(key)}`);
  source = stream;
  for (const type of ['player', 'table', 'queue', 'friends', 'club', 'tournament', 'tournaments']) {
    stream.addEventListener(type, (event) => {
      const payload = (event as MessageEvent<string>).data;
      let data: unknown = null;
      try {
        data = JSON.parse(payload);
      } catch {
        data = null;
      }
      if (type === 'player') void refreshMe();
      emit(type, data);
    });
  }
}

export function topicsFor(extra: string[]): string[] {
  const topics = [...extra];
  if (state.me) topics.push(`player:${state.me.id}`);
  return topics;
}

export function watchMotionPreference(): void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', () => {
    if (state.me) applySettings(state.me.settings);
    else applyGuestSettings();
  });
}

export function watchConnectivity(): void {
  const update = (): void => {
    state.online = navigator.onLine;
    notify();
  };
  window.addEventListener('online', () => {
    update();
    void refreshMe();
  });
  window.addEventListener('offline', update);
}
