import { api, isFailure } from './lib/api.js';
import { h, clear, statusRegion } from './lib/dom.js';
import { copy } from './lib/copy.js';
import type { User } from './lib/types.js';
import { renderBoard } from './screens/board.js';
import { renderRequests, renderRequestDetail, renderNewRequest } from './screens/requests.js';
import { renderOfferPage } from './screens/offer.js';
import { renderMyPage } from './screens/me.js';
import { renderPreferences } from './screens/preferences.js';
import { renderBilling, renderInvoices } from './screens/billing.js';
import { renderSignIn } from './screens/signin.js';

const app = document.getElementById('app')!;

interface AppState {
  user: User | null;
}

export const state: AppState = { user: null };

// A message shown once in the next screen's status region after a navigation.
export let flash: { text: string; kind?: 'pending' | 'success' | 'error' } | null = null;
export function setFlash(text: string, kind?: 'pending' | 'success' | 'error'): void {
  flash = { text, kind };
}
export function takeFlash(): { text: string; kind?: 'pending' | 'success' | 'error' } | null {
  const f = flash;
  flash = null;
  return f;
}

const LANDING: Record<User['role'], string> = {
  coordinator: '/board',
  requester: '/requests',
  interpreter: '/me',
  consumer: '/preferences',
  billing: '/billing',
};

const NAV: Record<User['role'], Array<[string, string]>> = {
  coordinator: [['Dispatch board', '/board']],
  requester: [['Requests', '/requests'], ['Invoices', '/invoices']],
  interpreter: [['My work', '/me']],
  consumer: [['Preferences', '/preferences']],
  billing: [['Billing', '/billing'], ['Invoices', '/invoices']],
};

// ---------- service status banner ----------

const banner = statusRegion('Service status');
banner.el.classList.add('status-banner');
let bannerTimer: ReturnType<typeof setInterval> | null = null;

async function pollSystemStatus(): Promise<void> {
  try {
    const status = await api.get<{ postgres: string; killbill: string; mail: string; storage: string }>('/system/status');
    if (status.killbill === 'down' && status.mail === 'down') {
      banner.set(`${copy.status.billingDown} ${copy.status.mailDown}`, 'error');
    } else if (status.killbill === 'down') {
      banner.set(copy.status.billingDown, 'error');
    } else if (status.mail === 'down') {
      banner.set(copy.status.mailDown, 'error');
    } else {
      banner.set('', undefined);
    }
  } catch {
    banner.set('', undefined);
  }
}

// ---------- shell ----------

function shell(content: HTMLElement): void {
  clear(app);
  const topbar = h('div', { class: 'topbar' });
  topbar.appendChild(h('span', { class: 'brand' }, 'Seatweaver'));
  if (state.user) {
    const nav = h('nav', { 'aria-label': 'Main' });
    for (const [label, path] of NAV[state.user.role]) {
      nav.appendChild(h('a', { href: path, 'aria-current': location.pathname === path ? 'page' : null }, label));
    }
    topbar.appendChild(nav);
    topbar.appendChild(h('span', { class: 'spacer' }));
    topbar.appendChild(h('span', { class: 'who' }, state.user.name));
    const signOut = h('button', { onclick: async () => { await api.del('/session'); state.user = null; navigate('/signin'); } }, 'Sign out');
    topbar.appendChild(signOut);
  } else {
    topbar.appendChild(h('span', { class: 'spacer' }));
  }
  app.appendChild(topbar);
  if (state.user) app.appendChild(banner.el);
  app.appendChild(content);
}

function titleFor(path: string): string {
  if (path.startsWith('/offers/')) return 'Offer';
  return path;
}

// ---------- router ----------

let controller: AbortController | null = null;

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  route();
}

async function route(): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  const path = location.pathname;
  window.scrollTo(0, 0);

  if (path.startsWith('/offers/')) {
    shell(renderOfferPage(path.slice('/offers/'.length)));
    return;
  }

  if (!state.user) {
    shell(renderSignIn());
    return;
  }

  const role = state.user.role;
  if (bannerTimer === null) {
    void pollSystemStatus();
    bannerTimer = setInterval(() => { void pollSystemStatus(); }, 25_000);
  }

  let screen: HTMLElement;
  if (path === '/board' && role === 'coordinator') {
    screen = renderBoard(controller.signal);
  } else if (path === '/requests' && role === 'requester') {
    screen = await renderRequests();
  } else if (path === '/requests/new' && role === 'requester') {
    screen = renderNewRequest();
  } else if (path.startsWith('/requests/') && ['requester', 'coordinator', 'billing'].includes(role)) {
    screen = await renderRequestDetail(path.slice('/requests/'.length));
  } else if (path === '/invoices' && ['requester', 'billing'].includes(role)) {
    screen = await renderInvoices();
  } else if (path === '/me' && role === 'interpreter') {
    screen = renderMyPage(controller.signal);
  } else if (path === '/preferences' && role === 'consumer') {
    screen = await renderPreferences();
  } else if (path === '/billing' && role === 'billing') {
    screen = renderBilling(controller.signal);
  } else {
    screen = h('div', { class: 'column' }, h('h1', {}, 'Not found'), h('p', { class: 'muted' }, 'There is nothing at this address for you.'));
  }
  shell(screen);
}

window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  if (!(e.target instanceof HTMLAnchorElement)) return;
  const href = e.target.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('/api')) return;
  e.preventDefault();
  navigate(href);
});

async function boot(): Promise<void> {
  try {
    const me = await api.get<{ user: User }>('/me');
    state.user = me.user;
  } catch (err) {
    if (isFailure(err) && err.status === 401) state.user = null;
    else state.user = null;
  }
  const path = location.pathname;
  if (!state.user && path !== '/signin' && !path.startsWith('/offers/')) {
    history.replaceState({}, '', '/signin');
  } else if (state.user && (path === '/signin' || path === '/')) {
    history.replaceState({}, '', LANDING[state.user.role]);
  }
  route();
}

void boot();
