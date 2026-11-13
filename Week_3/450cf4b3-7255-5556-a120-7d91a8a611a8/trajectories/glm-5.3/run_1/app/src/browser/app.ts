import { api, state, Me, ApiFail, focusSafe, clear } from './lib.js';
import { announce } from './live.js';
import { renderBoard } from './screens/board.js';
import { renderPacks } from './screens/packs.js';
import { renderDocuments } from './screens/documents.js';
import { renderTenants } from './screens/tenants.js';
import { renderTenantDetail } from './screens/tenantDetail.js';
import { renderReport } from './screens/report.js';
import { renderReceipt } from './screens/receipt.js';
import { renderSignIn, renderApply } from './screens/auth.js';

export interface ScreenCtx {
  app: HTMLElement;
  path: string;
  url: URL;
  params: Record<string, string>;
}

type Screen = 'signin' | 'apply' | 'board' | 'packs' | 'documents' | 'tenants' | 'tenantDetail' | 'report' | 'receipt';

const ROLE_PATHS: Record<'owner' | 'shift_lead' | 'tenant', string[]> = {
  owner: ['/board', '/tenants', '/report', '/receipt', '/tenants/*'],
  shift_lead: ['/board'],
  tenant: ['/board', '/packs', '/documents', '/receipt'],
};

let currentCleanup: (() => void) | null = null;

export function parseScreenPath(pathname: string): { screen: Screen | null; params: Record<string, string> } {
  if (pathname === '/' || pathname === '') return { screen: null, params: {} };
  if (pathname === '/signin') return { screen: 'signin', params: {} };
  if (pathname === '/apply') return { screen: 'apply', params: {} };
  if (pathname === '/board') return { screen: 'board', params: {} };
  if (pathname === '/packs') return { screen: 'packs', params: {} };
  if (pathname === '/documents') return { screen: 'documents', params: {} };
  if (pathname === '/tenants') return { screen: 'tenants', params: {} };
  if (pathname === '/report') return { screen: 'report', params: {} };
  const receipt = /^\/receipt\/([^/]+)$/.exec(pathname);
  if (receipt) return { screen: 'receipt', params: { id: receipt[1] } };
  const tenant = /^\/tenants\/([^/]+)$/.exec(pathname);
  if (tenant) return { screen: 'tenantDetail', params: { id: tenant[1] } };
  return { screen: null, params: {} };
}

// Where sign-in may return to: one check for the `next` value.
export function screenPathForRole(role: string, pathname: string): string | null {
  const allowed = ROLE_PATHS[role as 'owner' | 'shift_lead' | 'tenant'] ?? [];
  for (const pattern of allowed) {
    if (pattern.endsWith('/*')) {
      if (pathname.startsWith(pattern.slice(0, -1))) return pathname;
    } else if (pathname === pattern) {
      return pathname;
    }
  }
  return null;
}

export function validNext(raw: string | null, role: string): string | null {
  if (raw === null) return null;
  if (!/^\/[a-z]/.test(raw)) return null;
  if (/[\\\s\x00-\x1F]/.test(raw)) return null;
  const lower = raw.toLowerCase();
  if (lower.includes('%2f') || lower.includes('%5c') || lower.includes('%09') || lower.includes('%0a') || lower.includes('%0d')) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, location.origin);
  } catch {
    return null;
  }
  if (resolved.origin !== location.origin) return null;
  const path = screenPathForRole(role, resolved.pathname);
  if (path === null) return null;
  return resolved.pathname + resolved.search;
}

export async function refreshMe(): Promise<Me | null> {
  const r = await api('GET', '/api/me');
  if (r.status === 200 && r.ok) {
    state.me = r.ok as Me;
    state.sessionId = state.me.id;
    return state.me;
  }
  state.me = null;
  state.sessionId = 'anon';
  return null;
}

export async function showScreen(app: HTMLElement, pushUrl: string | null = null): Promise<void> {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  const url = new URL(pushUrl ?? location.href);
  const parsed = parseScreenPath(url.pathname);

  if (!state.me) {
    const me = await refreshMe();
    if (!me) {
      // A signed-out visit to any screen path shows Sign in with ?next=.
      const requested = url.pathname === '/signin' || url.pathname === '/apply' ? null : url.pathname + url.search;
      if (parsed.screen === 'apply') {
        clear(app);
        await renderApply(app, url);
        return;
      }
      clear(app);
      await renderSignIn(app, url, requested ?? '');
      return;
    }
  }

  const me = state.me!;
  if (parsed.screen === 'signin' || parsed.screen === 'apply' || parsed.screen === null) {
    history.replaceState(null, '', '/board');
    url.pathname = '/board';
    if (parsed.screen === 'signin' || parsed.screen === 'apply') {
      clear(app);
      await drawBoard(app, url);
      return;
    }
  }

  const path = url.pathname;
  const allowed = screenPathForRole(me.role, path);
  if (allowed === null) {
    history.replaceState(null, '', '/board');
    url.pathname = '/board';
    url.search = '';
    clear(app);
    await drawBoard(app, url);
    focusBoardHeading(app);
    return;
  }

  switch (parsed.screen) {
    case 'board':
      await drawBoard(app, url);
      break;
    case 'packs':
      clear(app);
      currentCleanup = renderPacks(app);
      break;
    case 'documents':
      clear(app);
      currentCleanup = renderDocuments(app, url);
      break;
    case 'tenants':
      clear(app);
      currentCleanup = renderTenants(app);
      break;
    case 'tenantDetail':
      clear(app);
      currentCleanup = renderTenantDetail(app, url, parsed.params.id);
      break;
    case 'report':
      clear(app);
      currentCleanup = renderReport(app, url);
      break;
    case 'receipt':
      clear(app);
      currentCleanup = renderReceipt(app, url, parsed.params.id);
      break;
    default:
      await drawBoard(app, url);
  }
}

function focusBoardHeading(app: HTMLElement): void {
  focusSafe(app.querySelector('h1'));
}

async function drawBoard(app: HTMLElement, url: URL): Promise<void> {
  clear(app);
  currentCleanup = renderBoard(app, url);
}

export function scheduleCleanup(fn: () => void): void {
  currentCleanup = fn;
}

export function historyPush(url: string): void {
  history.pushState(null, '', url);
}

export async function handle401(fail: ApiFail, app: HTMLElement): Promise<void> {
  if (fail.status === 401) {
    announce('Your session ended. Sign in again.');
    state.me = null;
    state.sessionId = 'anon';
    const current = location.pathname + location.search;
    history.replaceState(null, '', `/signin?next=${encodeURIComponent(current)}`);
    await showScreen(app);
  }
}

export function startApp(): void {
  const app = document.getElementById('app') as HTMLElement;
  window.addEventListener('popstate', () => {
    void showScreen(app);
  });
  void showScreen(app);
}
