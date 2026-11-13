// Long Rail Headstring application entry: routes, shared state, live events.

import { el, api, navigate, qs, fmt, copy, TIERS } from './ui.js';

export const state = {
  me: null,
  settings: { sound: true, music: false, aimSensitivity: 5, leftHanded: false, reducedMotion: false, theme: 'dark' },
  storeDown: false,
  lastCoins: null,
  lastCash: null,
  live: null,
  liveTopics: new Set(),
};

export const reducedMotion = () =>
  state.settings.reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function applyTheme() {
  const theme = state.me?.settings?.theme ?? state.settings.theme;
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  document.documentElement.dataset.theme = resolved;
}

export function applyMotionPreference() {
  document.body.dataset.reduced = reducedMotion() ? 'true' : 'false';
}

export function setChips() {
  const chips = document.getElementById('chips');
  if (!chips) return;
  const signedIn = Boolean(state.me);
  chips.hidden = !signedIn;
  if (!signedIn) return;
  const coinsEl = document.getElementById('coins-value');
  const cashEl = document.getElementById('cash-value');
  if (state.me) {
    coinsEl.textContent = fmt(state.me.coins);
    cashEl.textContent = fmt(state.me.cash);
    const chipCoins = document.getElementById('chip-coins');
    const chipCash = document.getElementById('chip-cash');
    const stale = state.storeDown ? ` <span class="stale">${copy.stale}</span>` : '';
    chipCoins.innerHTML = `<span aria-hidden="true">🪙</span> <span class="num">${fmt(state.me.coins)}</span>${stale}`;
    chipCash.innerHTML = `<span aria-hidden="true">💠</span> <span class="num">${fmt(state.me.cash)}</span>${stale}`;
    chipCoins.setAttribute('role', 'status');
    chipCoins.setAttribute('aria-label', 'Coins');
    chipCash.setAttribute('role', 'status');
    chipCash.setAttribute('aria-label', 'Cash');
  }
}

export function stashChips() {
  if (state.me) {
    state.lastCoins = state.me.coins;
    state.lastCash = state.me.cash;
  }
}

export function offlineMode() {
  return navigator.onLine === false;
}

export function markStoreDown() {
  state.storeDown = true;
  setChips();
}

export function clearStoreDown() {
  state.storeDown = false;
}

export async function loadMe() {
  try {
    const me = await api('/api/me');
    state.me = me;
    state.settings = { ...state.settings, ...me.settings };
    clearStoreDown();
    applyTheme();
    applyMotionPreference();
    setChips();
    return me;
  } catch (err) {
    if (err.status === 503) markStoreDown();
    if (err.status === 401) state.me = null;
    throw err;
  }
}

export async function openLive(topics) {
  state.liveTopics = new Set(topics);
  if (state.live) return state.live;
  const params = [...state.liveTopics].map((t) => `topic=${encodeURIComponent(t)}`).join('&');
  const source = new EventSource(`/api/events${params ? `?${params}` : ''}`);
  state.live = source;
  return source;
}

export function closeLive() {
  if (state.live) {
    state.live.close();
    state.live = null;
  }
}

export function onLive(handler) {
  const listener = (event) => {
    let data = null;
    try { data = JSON.parse(event.data); } catch { data = null; }
    if (data) handler(data);
  };
  if (state.live) state.live.addEventListener('message', listener);
  return () => {
    if (state.live) state.live.removeEventListener('message', listener);
  };
}

export function mainHeading(text) {
  return el('h1', { text });
}

export function renderHeading(title) {
  const main = document.getElementById('app');
  main.replaceChildren(mainHeading(title));
}

export async function ensureMe() {
  if (!state.me) {
    try { await loadMe(); } catch { state.me = null; }
  }
  return state.me;
}

export function guestAction(kind) {
  // Opens the sign-up sheet; after sign-up the tapped action resumes.
  sessionStorage.setItem('resume', kind);
  window.dispatchEvent(new CustomEvent('open-signup', { detail: { resume: kind } }));
}

export function resumeAfterAuth() {
  const kind = sessionStorage.getItem('resume') ?? 'home';
  sessionStorage.removeItem('resume');
  if (kind === 'play') navigate('/play');
  else if (kind === 'special') navigate('/play/special');
  else if (kind === 'friends') navigate('/home?friends=1');
  else if (kind === 'shop') navigate('/shop');
  else if (kind === 'tournaments') navigate('/tournaments');
  else if (kind === 'clubs') navigate('/clubs');
  else if (kind === 'leaderboards') navigate('/leaderboards');
  else navigate('/home');
}
