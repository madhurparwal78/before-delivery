/**
 * App state: the signed-in user, their units, the current route, and the
 * service notice. A single store every screen reads.
 */
import { api, type Me, type Units } from './api.ts';

export interface AppState {
  me: Me | null;
  units: Units;
  status: { storage: 'up' | 'down'; billing: 'up' | 'down'; mail: 'up' | 'down' };
  route: { path: string; query: URLSearchParams };
}

export const state: AppState = {
  me: null,
  units: { film: 'um', pressure: 'bar', distance: 'km' },
  status: { storage: 'up', billing: 'up', mail: 'up' },
  route: { path: '/', query: new URLSearchParams() },
};

export function isStaff(): boolean {
  return state.me !== null && state.me.role !== 'owner';
}

export async function loadMe(): Promise<void> {
  try {
    const response = (await api.getQuiet('/api/me')) as { user: Me; units: Units };
    state.me = response.user;
    state.units = response.units;
  } catch {
    state.me = null;
  }
}

export async function loadStatus(): Promise<void> {
  try {
    const response = (await api.get('/api/status')) as AppState['status'];
    state.status = response;
  } catch {
    // keep the last known
  }
}

export function setRoute(): void {
  const url = new URL(window.location.href);
  state.route = { path: url.pathname, query: url.searchParams };
}

export function replaceHistory(path: string, query?: URLSearchParams): void {
  const search = query ? (query.toString() ? `?${query.toString()}` : '') : window.location.search;
  window.history.replaceState({}, '', `${path}${search}`);
  setRoute();
}
