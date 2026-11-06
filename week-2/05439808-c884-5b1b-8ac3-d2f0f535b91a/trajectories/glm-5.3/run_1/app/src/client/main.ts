// Saltreach client entry: routing, session guards and screen dispatch.
import { ensureLiveRegions, clearNotices, alertMessage, notice } from './ui.ts';
import { api, setCsrfToken } from './api.ts';
import * as auth from './screens/auth.ts';
import * as village from './screens/village.ts';
import * as raidScreen from './screens/raid.ts';
import * as replayScreen from './screens/replay.ts';
import * as ops from './screens/ops.ts';
import { beginPolling, loadSessionAndUser, showPendingAuthNotices, state, stopPoller } from './state.ts';

interface RouteDef {
  pattern: RegExp;
  keys: string[];
  render: (params: Record<string, string>) => Promise<void>;
  auth: 'public' | 'session' | 'operator';
  currentParams?: Record<string, string>;
}

const routes: RouteDef[] = [
  { pattern: /^\/signin$/, keys: [], render: () => auth.renderSignIn(root), auth: 'public' },
  { pattern: /^\/signup$/, keys: [], render: () => auth.renderSignUp(root), auth: 'public' },
  { pattern: /^\/forgot$/, keys: [], render: () => auth.renderForgot(root), auth: 'public' },
  { pattern: /^\/reset$/, keys: [], render: () => auth.renderReset(root), auth: 'public' },
  { pattern: /^\/verify$/, keys: [], render: () => auth.renderVerify(root), auth: 'public' },
  { pattern: /^\/scout$/, keys: [], render: () => raidScreen.renderScout(root, null), auth: 'session' },
  { pattern: /^\/scout\/([1-9][0-9]{0,15})$/, keys: ['villageId'], render: (p) => raidScreen.renderScout(root, p.villageId), auth: 'session' },
  { pattern: /^\/raids\/([1-9][0-9]{0,15})$/, keys: ['raidId'], render: (p) => raidScreen.renderRaid(root, p.raidId), auth: 'session' },
  { pattern: /^\/raids\/([1-9][0-9]{0,15})\/replay$/, keys: ['raidId'], render: (p) => replayScreen.renderReplay(root, p.raidId), auth: 'session' },
  { pattern: /^\/ops$/, keys: [], render: () => ops.renderOps(root), auth: 'operator' },
  { pattern: /^\/$/, keys: [], render: () => village.renderVillage(root), auth: 'session' },
];

let root: HTMLElement;
const cleanups: Array<() => void> = [];

export function onScreenCleanup(fn: () => void): void {
  cleanups.push(fn);
}

function matchRoute(path: string): RouteDef | null {
  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      route.currentParams = {};
      route.keys.forEach((key, index) => {
        route.currentParams![key] = match[index + 1];
      });
      return route;
    }
  }
  return null;
}

export async function navigate(path: string, replace = false): Promise<void> {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  await dispatch();
}

export async function dispatch(): Promise<void> {
  const path = location.pathname;
  const route = matchRoute(path) ?? matchRoute('/');
  if (route === null) return;

  clearNotices();
  if (route.auth !== 'public') {
    if (state.me === null) {
      await loadSessionAndUser().catch(() => null);
    }
    if (state.me === null) {
      history.replaceState({}, '', '/signin');
      void showPendingAuthNotices();
      await auth.renderSignIn(root);
      return;
    }
    if (route.auth === 'operator' && state.me.role !== 'operator') {
      history.replaceState({}, '', '/');
      await village.renderVillage(root);
      return;
    }
  } else if (state.me !== null && (path === '/signin' || path === '/signup')) {
    const target = state.me.role === 'operator' ? '/ops' : '/';
    history.replaceState({}, '', target);
    if (target === '/ops') await ops.renderOps(root);
    else await village.renderVillage(root);
    return;
  }

  stopPoller();
  for (const cleanup of cleanups.splice(0)) cleanup();
  await route.render(route.currentParams ?? {});
  beginPolling();
}

window.addEventListener('popstate', () => {
  void dispatch();
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { api?: { status?: number } } | null;
  if (reason && typeof reason === 'object' && reason.api?.status === 503) {
    alertMessage('The tide records are out of reach. Nothing was changed — try again in a moment.');
  }
});

async function boot(): Promise<void> {
  root = document.getElementById('app') as HTMLElement;
  root.replaceChildren();
  ensureLiveRegions();
  try {
    const session = await api<{ user: typeof state.me; csrfToken: string }>('GET', '/api/session');
    setCsrfToken(session.csrfToken);
    state.me = session.user;
  } catch {
    // offline or database down: the screens show the outage copy
  }
  await dispatch();
  void showPendingAuthNotices();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void boot());
} else {
  void boot();
}
