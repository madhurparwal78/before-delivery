import { DEFAULT_LANDING, safeNextPath } from '../shared/next-path.js';
import { GLOBAL_COPY } from '../shared/messages.js';
import { api } from './api.js';
import { clearScreenRegions, regions } from './regions.js';
import { appState, loadCopy, setAccount, setSignedOutWithWork } from './state.js';
import { broadcast, reloadJournal } from './journal.js';
import { put, STORE_META } from './idb.js';
import { resetPrefetch } from './prefetch.js';
import { setDialogOpen } from './field.js';
import { setStatus } from './dom.js';

export interface ScreenContext {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type ScreenRender = (context: ScreenContext) => Promise<HTMLElement>;

export interface Route {
  pattern: RegExp;
  names: string[];
  guarded: boolean;
  render: ScreenRender;
}

let routes: Route[] = [];
let notFound: () => HTMLElement = () => document.createElement('div');
let mount: HTMLElement | null = null;
let leaveCurrentScreen: (() => void) | null = null;
let renderToken = 0;

export function configureRouter(options: {
  mount: HTMLElement;
  routes: Route[];
  notFound: () => HTMLElement;
}): void {
  mount = options.mount;
  routes = options.routes;
  notFound = options.notFound;
}

/** Screens register anything they must stop when the observer leaves. */
export function onLeaveScreen(callback: () => void): void {
  const previous = leaveCurrentScreen;
  leaveCurrentScreen = () => {
    previous?.();
    callback();
  };
}

/**
 * Remembered on the device, so a visit with no network knows whether the
 * observer signed out or merely lost signal.
 */
export function setDeviceSignedOut(value: boolean): void {
  void put(STORE_META, value, 'signed_out').catch(() => undefined);
}

export function currentPathAndQuery(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const target = path.startsWith('/') ? path : `/${path}`;
  if (options.replace) window.history.replaceState({}, '', target);
  else window.history.pushState({}, '', target);
  void renderRoute();
}

/** Only the address changes: the observation stays open on the same screen. */
export function replaceAddress(path: string): void {
  window.history.replaceState({}, '', path);
}

function match(pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    const found = route.pattern.exec(pathname);
    if (!found) continue;
    const params: Record<string, string> = {};
    route.names.forEach((name, index) => {
      params[name] = decodeURIComponent(found[index + 1] ?? '');
    });
    return { route, params };
  }
  return null;
}

export async function renderRoute(): Promise<void> {
  if (!mount) return;
  const token = ++renderToken;
  const pathname = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const state = appState();

  leaveCurrentScreen?.();
  leaveCurrentScreen = null;
  setDialogOpen(false);
  clearScreenRegions();

  // A device whose sign-in ended still holds its account, and must be able to
  // reach the sign-in form to send the work waiting on it.
  if ((pathname === '/signin' || pathname === '/signup') && state.account && !state.signedOutWithWork) {
    navigate(DEFAULT_LANDING, { replace: true });
    return;
  }

  const found = match(pathname);
  if (!found) {
    mount.replaceChildren(notFound());
    return;
  }

  if (found.route.guarded && !state.account) {
    // With no network and no explicit sign out the device's copy still shows.
    navigate(`/signin?next=${encodeURIComponent(currentPathAndQuery())}`, { replace: true });
    return;
  }

  const node = await found.route.render({ path: pathname, params: found.params, query });
  if (token !== renderToken) return;
  mount.replaceChildren(node);
  window.scrollTo(0, 0);
}

export function landingAfterSignIn(query: URLSearchParams): string {
  return safeNextPath(query.get('next'));
}

export async function signOutAndLand(): Promise<void> {
  const answer = await api.post('/api/auth/signout');
  if (answer.offline) {
    setStatus(regions.connection, GLOBAL_COPY.needs_signal);
    return;
  }
  setAccount(null);
  setDeviceSignedOut(true);
  setSignedOutWithWork(false);
  resetPrefetch();
  await reloadJournal();
  broadcast({ type: 'account', account_id: null });
  navigate('/');
}

export async function adoptAccountChange(accountId: string | null): Promise<void> {
  if (accountId === null) {
    setAccount(null);
    setDeviceSignedOut(true);
    setSignedOutWithWork(false);
    await reloadJournal();
    navigate('/', { replace: true });
    return;
  }
  const answer = await api.get<{ account: { id: string; email: string; display_name: string } }>(
    '/api/auth/me',
  );
  if (!answer.ok || !answer.body) return;
  setAccount(answer.body.account);
  setDeviceSignedOut(false);
  setSignedOutWithWork(false);
  resetPrefetch();
  await loadCopy(answer.body.account.id);
  await reloadJournal();
  navigate(DEFAULT_LANDING, { replace: true });
}
