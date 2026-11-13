import { el, announce, ensureStatusRegions } from './dom.js';
import { api } from './api.js';
import { navigate, installRouter, parsePath, type Route } from './router.js';
import type { Item, Profile, TripList, ListSummary } from './apiTypes.js';
import { renderCloset } from './pages/closet.js';
import { renderTrips, renderWorkspace } from './pages/trips.js';
import { renderImports } from './pages/imports.js';
import { renderSettings } from './pages/settings.js';
import { renderSignIn } from './pages/signin.js';
import { renderSharePage } from './pages/share.js';
import { syncNow } from './pages/sync.js';

/**
 * The single-page shell. It holds the hiker's session state, the cached
 * closet and profile, the offline banner, and the current page. Navigation
 * between signed-in pages happens inside the page, with no full reload.
 */

export interface AppState {
  signedIn: boolean;
  profile: Profile | null;
  items: Item[];
  lists: ListSummary[];
  online: boolean;
}

export const state: AppState = {
  signedIn: false,
  profile: null,
  items: [],
  lists: [],
  online: navigator.onLine,
};

export function currentUnit(): 'g' | 'oz' | 'lb' {
  return state.profile?.unit ?? 'g';
}

export function currentGoalGrams(): number {
  return state.profile?.goalGrams ?? 4500;
}

export function currentDisplayName(): string {
  return state.profile?.displayName ?? 'Hiker';
}

function appRoot(): HTMLElement {
  const existing = document.getElementById('app');
  if (existing !== null) return existing;
  const root = el('div', { id: 'app' });
  document.body.append(root);
  root.append(el('div', { id: 'page' }));
  return root;
}

export function renderHeader(): void {
  document.getElementById('site-header')?.remove();
  if (!state.signedIn) return;
  const header = el('header', { id: 'site-header', class: 'app-header' });
  const brand = el('span', { class: 'brand', text: 'Skinout' });
  const nav = el('nav', { 'aria-label': 'Main' });
  const current = parsePath(window.location.pathname).page;
  const addLink = (label: string, path: string, page: string): void => {
    const anchor = el('a', { href: path, text: label });
    if (page === current) anchor.setAttribute('aria-current', 'page');
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(path);
    });
    nav.append(anchor);
  };
  addLink('Closet', '/closet', 'closet');
  addLink('Trips', '/trips', 'trips');
  addLink('Imports', '/imports', 'imports');
  addLink('Settings', '/settings', 'settings');
  const signOut = el('button', { type: 'button', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void (async () => {
      await api.delete('/api/session');
      state.signedIn = false;
      navigate('/sign-in');
    })();
  });
  header.append(brand, nav, el('span', { class: 'spacer' }), signOut);
  document.body.prepend(header);
}

function renderOfflineBanner(): void {
  const existing = document.getElementById('offline-banner');
  if (state.online) {
    existing?.remove();
    announce('Connection', '');
    return;
  }
  if (existing !== null) return;
  const banner = el('div', { id: 'offline-banner', class: 'banner', role: 'status', 'aria-live': 'polite' });
  banner.textContent = "You're offline. Changes stay on this device and sync when you reconnect.";
  document.body.prepend(banner);
}

window.addEventListener('online', () => {
  state.online = true;
  renderOfflineBanner();
  void syncNow();
});
window.addEventListener('offline', () => {
  state.online = false;
  renderOfflineBanner();
});

export async function loadProfile(): Promise<boolean> {
  const answer = await api.get<{ profile: Profile }>('/api/profile');
  if (answer.ok) {
    state.profile = answer.body.profile;
    state.signedIn = true;
    return true;
  }
  // Offline, the cached profile keeps a previously signed-in shell usable;
  // a refused session (401) ends it for every tab.
  if (answer.failure.status === 401) {
    state.signedIn = false;
    return false;
  }
  return state.profile !== null && state.signedIn;
}

export async function loadCloset(): Promise<void> {
  const answer = await api.get<{ items: Item[] }>('/api/closet');
  // Offline, the last loaded closet keeps the ledger working.
  if (answer.ok) state.items = answer.body.items;
}

export async function loadLists(): Promise<void> {
  const answer = await api.get<{ lists: ListSummary[] }>('/api/lists');
  if (answer.ok) state.lists = answer.body.lists;
}

export async function loadList(id: string): Promise<TripList | null> {
  const answer = await api.get<{ list: TripList }>(`/api/lists/${id}`);
  // Offline, the service worker answers from its cache of the last read.
  if (answer.ok) return answer.body.list;
  return null;
}

export function pageHost(): HTMLElement {
  const root = appRoot();
  const page = document.getElementById('page');
  if (page !== null) return page;
  const fresh = el('div', { id: 'page' });
  root.append(fresh);
  return fresh;
}

async function guardOwner(): Promise<boolean> {
  const ok = await loadProfile();
  if (!ok) {
    // Offline, a previously signed-in session keeps its cached shell.
    if (!state.online && state.profile !== null) {
      state.signedIn = true;
      renderHeader();
      return true;
    }
    navigate('/sign-in', true);
    return false;
  }
  renderHeader();
  return true;
}

installRouter(async (route: Route) => {
  // The published live regions exist from the start and are never rebuilt.
  ensureStatusRegions(['Closet updates', 'Pack updates', 'Sync results', 'List state', 'Pack sheet', 'Sharing', 'Connection', 'Import', 'Settings']);
  const page = pageHost();
  page.textContent = '';
  renderOfflineBanner();
  switch (route.page) {
    case 'sign-in':
      renderSignIn(page);
      return;
    case 'share':
      await renderSharePage(page, route.token);
      return;
    default:
      break;
  }
  if (!(await guardOwner())) return;
  switch (route.page) {
    case 'closet':
      await renderCloset(page);
      return;
    case 'trips':
      await renderTrips(page);
      return;
    case 'imports':
      await renderImports(page, route.openDialog === true);
      return;
    case 'settings':
      await renderSettings(page);
      return;
    case 'workspace':
      await renderWorkspace(page, route.listId);
      return;
    default:
      await renderTrips(page);
  }
});
