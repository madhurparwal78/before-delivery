import { handleSessionEnd, request } from './api';
import { el, focusElement, setText } from './dom';
import { icon } from './icons';
import { KITCHEN_CLOCK_MS, Refreshes } from './refresh';
import {
  announce,
  clearAnnouncements,
  kitchen,
  loadKitchen,
  registerLiveRegion,
  setNavigator,
  updateKitchenClock,
  type Screen,
  type ScreenContext,
} from './shell';
import { clearPurchaseAttempt, session, startNewSignIn } from './state';
import * as copy from './copy';
import { mountApply } from './screens/apply';
import { mountSignIn } from './screens/signin';
import { mountDocuments } from './screens/documents';
import { mountPacks } from './screens/packs';
import { mountTenants } from './screens/tenants';
import { mountTenantDetail } from './screens/tenant';
import { mountReport } from './screens/report';
import { mountReceipt } from './screens/receipt';
import { mountBoard } from './board/board';
import { KITCHEN_NAME } from '../shared/copy';
import type { Me, Role } from '../shared/types';

type ScreenName =
  | 'signin'
  | 'apply'
  | 'board'
  | 'packs'
  | 'documents'
  | 'tenants'
  | 'tenant'
  | 'report'
  | 'receipt';

interface Match {
  name: ScreenName;
  params: Record<string, string>;
}

const ROLE_SCREENS: Record<Role, ReadonlyArray<ScreenName>> = {
  tenant: ['board', 'packs', 'documents', 'receipt'],
  owner: ['board', 'tenants', 'tenant', 'report', 'receipt'],
  shift_lead: ['board'],
};

const NAV_LINKS: Record<Role, ReadonlyArray<{ label: string; href: string }>> = {
  tenant: [
    { label: 'Board', href: '/board' },
    { label: 'Hour packs', href: '/packs' },
    { label: 'Documents', href: '/documents' },
  ],
  owner: [
    { label: 'Board', href: '/board' },
    { label: 'Tenants', href: '/tenants' },
    { label: 'Report', href: '/report' },
  ],
  shift_lead: [{ label: 'Board', href: '/board' }],
};

function matchPath(path: string): Match | null {
  if (path === '/signin') return { name: 'signin', params: {} };
  if (path === '/apply') return { name: 'apply', params: {} };
  if (path === '/board') return { name: 'board', params: {} };
  if (path === '/packs') return { name: 'packs', params: {} };
  if (path === '/documents') return { name: 'documents', params: {} };
  if (path === '/tenants') return { name: 'tenants', params: {} };
  if (path === '/report') return { name: 'report', params: {} };
  const tenantMatch = /^\/tenants\/([^/]+)$/.exec(path);
  if (tenantMatch !== null) return { name: 'tenant', params: { id: tenantMatch[1] ?? '' } };
  const receiptMatch = /^\/receipt\/([^/]+)$/.exec(path);
  if (receiptMatch !== null) return { name: 'receipt', params: { id: receiptMatch[1] ?? '' } };
  return null;
}

const root = document.getElementById('app');
if (root === null) throw new Error('missing app root');

const header = el('header', { className: 'app-header' });
const kitchenName = el('p', { className: 'kitchen-name', text: KITCHEN_NAME });
const clockText = el('p', { className: 'kitchen-clock' });
clockText.prepend(icon('clock'));
const menuButton = el('button', {
  text: 'Menu',
  className: 'button menu-button',
  attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'nav-panel' },
});
const navPanel = el('div', { className: 'nav-panel', attrs: { id: 'nav-panel' } });
const nav = el('nav', { className: 'main-nav', attrs: { 'aria-label': 'Main' } });
const signOutButton = el('button', {
  text: 'Sign out',
  className: 'button quiet',
  attrs: { type: 'button' },
});
navPanel.append(nav, signOutButton);
header.append(kitchenName, clockText);

const liveRegion = el('p', {
  className: 'kitchen-updates',
  attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Kitchen updates' },
});
const screenRoot = el('main', { className: 'screen-root', attrs: { id: 'screen' } });
root.append(header, liveRegion, screenRoot);
registerLiveRegion(liveRegion);

const narrowQuery = window.matchMedia('(max-width: 599px)');
let menuOpen = false;

function renderNavigation(): void {
  const user = session.user;
  nav.textContent = '';
  if (user === null) {
    navPanel.remove();
    menuButton.remove();
    header.classList.add('signed-out');
    return;
  }
  header.classList.remove('signed-out');
  for (const link of NAV_LINKS[user.role]) {
    const anchor = el('a', { text: link.label, className: 'nav-link', attrs: { href: link.href } });
    anchor.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      if (narrowQuery.matches) closeMenu(false);
      navigate(link.href);
    });
    nav.append(anchor);
  }
  if (narrowQuery.matches) {
    if (!header.contains(menuButton)) header.append(menuButton);
    menuButton.setAttribute('aria-expanded', menuOpen ? 'true' : 'false');
    if (menuOpen) {
      if (!header.contains(navPanel)) header.append(navPanel);
    } else {
      navPanel.remove();
    }
  } else {
    menuButton.remove();
    if (!header.contains(navPanel)) header.append(navPanel);
  }
}

function openMenu(): void {
  menuOpen = true;
  renderNavigation();
  const first = nav.querySelector('a');
  if (first instanceof HTMLElement) focusElement(first);
}

function closeMenu(returnFocus: boolean): void {
  menuOpen = false;
  renderNavigation();
  if (returnFocus) focusElement(menuButton);
}

menuButton.addEventListener('click', () => {
  if (menuOpen) closeMenu(true);
  else openMenu();
});
header.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menuOpen) {
    event.preventDefault();
    closeMenu(true);
  }
});
narrowQuery.addEventListener('change', () => {
  menuOpen = false;
  renderNavigation();
});

signOutButton.addEventListener('click', () => {
  void signOut();
});

let currentScreen: Screen | null = null;
let currentName: ScreenName | null = null;
let currentPath = '';

function navigate(path: string, options?: { replace?: boolean }): void {
  if (options?.replace === true) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render();
}
setNavigator(navigate);

async function signOut(): Promise<void> {
  const previousId = session.lastUserId;
  await request('DELETE', '/api/session');
  if (previousId !== null) clearPurchaseAttempt(previousId);
  startNewSignIn(null, null);
  session.uploadDraft = null;
  clearAnnouncements();
  currentScreen?.unmount();
  currentScreen = null;
  currentName = null;
  screenRoot.textContent = '';
  renderNavigation();
  navigate('/signin', { replace: true });
}

handleSessionEnd(() => {
  const target = `${window.location.pathname}${window.location.search}`;
  session.user = null;
  renderNavigation();
  announce(copy.sessionEnded);
  if (window.location.pathname !== '/signin') {
    window.history.replaceState({}, '', `/signin?next=${encodeURIComponent(target)}`);
  }
  void render();
});

const REJECTED_SEQUENCES = ['%2f', '%5c', '%09', '%0a', '%0d'];

async function resolveNext(raw: string | null, user: Me): Promise<string | null> {
  if (raw === null || raw === '') return null;
  if (!/^\/[a-z]/.test(raw)) return null;
  if (/[\\\s]/.test(raw)) return null;
  const lowered = raw.toLowerCase();
  if (REJECTED_SEQUENCES.some((sequence) => lowered.includes(sequence))) return null;
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return null;
  }
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  const match = matchPath(url.pathname);
  if (match === null) return null;
  if (!ROLE_SCREENS[user.role].includes(match.name)) return null;
  if (match.name === 'receipt') {
    const result = await request('GET', `/api/bookings/${match.params.id ?? ''}`);
    if (result.kind !== 'ok') return null;
  }
  if (match.name === 'tenant') {
    const result = await request('GET', `/api/tenants/${match.params.id ?? ''}`);
    if (result.kind !== 'ok') return null;
  }
  return `${url.pathname}${url.search}`;
}

async function onSignedIn(user: Me, nextValue: string | null): Promise<void> {
  const previousId = session.lastUserId;
  const sameAccount = previousId === user.id;
  if (previousId !== null && !sameAccount) clearPurchaseAttempt(previousId);
  currentScreen?.unmount();
  currentScreen = null;
  currentName = null;
  screenRoot.textContent = '';
  startNewSignIn(user, sameAccount ? user.id : null);
  clearAnnouncements();
  renderNavigation();
  const target = (await resolveNext(nextValue, user)) ?? '/board';
  window.history.replaceState({}, '', target);
  await render();
}

async function mountScreen(name: ScreenName, params: Record<string, string>): Promise<Screen> {
  const ctx: ScreenContext = {
    root: screenRoot,
    params,
    query: new URLSearchParams(window.location.search),
    user: session.user,
  };
  switch (name) {
    case 'signin':
      return mountSignIn(ctx, {
        onSignedIn: (user, nextValue) => {
          void onSignedIn(user, nextValue);
        },
      });
    case 'apply':
      return mountApply(ctx, {
        onApplied: (user) => {
          void (async () => {
            currentScreen?.unmount();
            currentScreen = null;
            currentName = null;
            screenRoot.textContent = '';
            startNewSignIn(user, null);
            renderNavigation();
            window.history.replaceState({}, '', '/documents');
            await render();
            announce(copy.apply.success);
          })();
        },
      });
    case 'board':
      return mountBoard(ctx);
    case 'packs':
      return mountPacks(ctx);
    case 'documents':
      return mountDocuments(ctx);
    case 'tenants':
      return mountTenants(ctx);
    case 'tenant':
      return mountTenantDetail(ctx);
    case 'report':
      return mountReport(ctx);
    case 'receipt':
      return mountReceipt(ctx);
  }
}

let renderSequence = 0;

async function render(): Promise<void> {
  const sequence = renderSequence + 1;
  renderSequence = sequence;
  const path = window.location.pathname;
  const user = session.user;

  if (path === '/') {
    window.history.replaceState({}, '', user === null ? '/signin' : '/board');
    await render();
    return;
  }

  let match = matchPath(path);
  if (match === null) {
    window.history.replaceState({}, '', user === null ? '/signin' : '/board');
    match = matchPath(window.location.pathname);
    if (match === null) return;
  }

  if (user === null) {
    if (match.name !== 'signin' && match.name !== 'apply') {
      const target = `${path}${window.location.search}`;
      window.history.replaceState({}, '', `/signin?next=${encodeURIComponent(target)}`);
      match = { name: 'signin', params: {} };
    }
  } else if (match.name === 'signin' || match.name === 'apply') {
    window.history.replaceState({}, '', '/board');
    match = { name: 'board', params: {} };
  } else if (!ROLE_SCREENS[user.role].includes(match.name)) {
    window.history.replaceState({}, '', '/board');
    match = { name: 'board', params: {} };
  }

  if (
    currentName === match.name &&
    currentPath === window.location.pathname &&
    currentScreen !== null &&
    currentScreen.updateQuery !== undefined
  ) {
    currentScreen.updateQuery(new URLSearchParams(window.location.search));
    return;
  }

  currentScreen?.unmount();
  currentScreen = null;
  screenRoot.textContent = '';
  renderNavigation();
  currentName = match.name;
  currentPath = window.location.pathname;
  const mounted = await mountScreen(match.name, match.params);
  if (sequence !== renderSequence) {
    mounted.unmount();
    return;
  }
  currentScreen = mounted;
}

window.addEventListener('popstate', () => {
  void render();
});

async function boot(): Promise<void> {
  await loadKitchen();
  const info = kitchen();
  if (info !== null) setText(kitchenName, info.name);
  const me = await request<Me>('GET', '/api/me', { silentUnauthenticated: true });
  if (me.kind === 'ok') {
    session.user = me.body;
    session.lastUserId = me.body.id;
  }
  renderNavigation();
  updateKitchenClock(clockText);
  const clockRefresh = new Refreshes();
  clockRefresh.every(KITCHEN_CLOCK_MS, () => updateKitchenClock(clockText));
  await render();
}

void boot();
