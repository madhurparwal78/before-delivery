import { api, apiOrNull, ApiFailure, freshKey, newSession, setUnauthorizedHandler, type KitchenInfo, type SessionInfo } from './api.js';
import { h, clear, hoursText, monthName } from './ui.js';
import { renderBoard, boardCleanup } from './board.js';
import { renderBookings } from './bookings.js';
import { renderDocuments } from './documents.js';
import { renderInvoices } from './invoices.js';
import { renderReports } from './reports.js';
import { renderSanitation } from './sanitation.js';
import { renderSettings } from './settings.js';
import { renderInspector } from './inspector.js';

export interface AppState {
  session: SessionInfo | null;
  kitchen: KitchenInfo | null;
  /** The member's hour bank for the month on screen. */
  hourBankBalance: number | null;
  hourBankMonth: string | null;
}

export const state: AppState = { session: null, kitchen: null, hourBankBalance: null, hourBankMonth: null };

const NAV_ITEMS: Record<string, { path: string; label: string }[]> = {
  member: [
    { path: '/board', label: 'Line board' },
    { path: '/bookings', label: 'Bookings' },
    { path: '/documents', label: 'Documents' },
    { path: '/invoices', label: 'Invoices' },
  ],
  shift_lead: [
    { path: '/board', label: 'Line board' },
    { path: '/documents', label: 'Documents' },
    { path: '/sanitation', label: 'Sanitation' },
  ],
  operator: [
    { path: '/board', label: 'Line board' },
    { path: '/bookings', label: 'Bookings' },
    { path: '/documents', label: 'Documents' },
    { path: '/invoices', label: 'Invoices' },
    { path: '/reports', label: 'Reports' },
    { path: '/sanitation', label: 'Sanitation' },
    { path: '/settings', label: 'Settings' },
  ],
};

const SCREENS = ['/board', '/bookings', '/documents', '/invoices', '/reports', '/sanitation', '/settings'];

function root(): HTMLElement {
  return document.getElementById('root')!;
}

let statusRegion: HTMLElement | null = null;
let alertRegion: HTMLElement | null = null;
let bannerRegion: HTMLElement | null = null;
let bannerTimer: number | null = null;

export function announce(text: string): void {
  if (statusRegion) statusRegion.textContent = text;
}

export function showAlert(text: string): void {
  if (alertRegion) alertRegion.textContent = text;
}

export function clearAlert(): void {
  if (alertRegion) alertRegion.textContent = '';
}

/** The service banner polls at least every 10 seconds, and re-reads at once
 * after the person's own actions answer while a service is down. */
function fetchStatusBanner(): void {
  void (async () => {
    const result = await apiOrNull<{ billing: string; storage: string; queued: { billing: number; storage: number } }>('GET', '/api/service-status');
    if (!result) return;
    drawBanner(result.data);
  })();
}

export function refreshBannerSoon(): void {
  window.setTimeout(fetchStatusBanner, 100);
}

function drawBanner(data: { billing: string; storage: string; queued: { billing: number; storage: number } }): void {
  if (!bannerRegion) return;
  const down = data.billing === 'down' || data.storage === 'down';
  const wasHidden = bannerRegion.classList.contains('hidden');
  clear(bannerRegion);
  if (data.billing === 'down') {
    bannerRegion.append(
      h('p', { text: 'Billing is unavailable. Confirmed bookings are saved and marked Pending billing; charges are recorded automatically when billing returns.' }),
    );
  }
  if (data.storage === 'down') {
    bannerRegion.append(
      h('p', { text: 'Document storage is unavailable. Uploads and downloads are paused; monthly sanitation PDFs are queued.' }),
    );
  }
  if (down) {
    bannerRegion.append(h('p', { text: `${data.queued.billing} billing items waiting · ${data.queued.storage} storage items waiting` }));
    bannerRegion.classList.remove('hidden');
  } else {
    bannerRegion.classList.add('hidden');
  }
  void wasHidden;
}

function startBannerPolling(): void {
  if (bannerTimer !== null) window.clearInterval(bannerTimer);
  bannerTimer = window.setInterval(fetchStatusBanner, 10000);
}

/** A valid next address is honoured only for the published signed-in screens. */
function validNext(next: string | null): string | null {
  if (!next) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  if (decoded.includes('\\')) return null;
  if (/[\x00-\x1f]/.test(decoded)) return null;
  if (decoded.includes('://')) return null;
  if (decoded.startsWith('//')) return null;
  if (decoded.includes('#')) return null;
  if (decoded.includes('@')) return null;
  const pathPart = decoded.split('?')[0];
  if (!SCREENS.includes(pathPart)) return null;
  return decoded;
}

function signInScreen(): void {
  boardCleanup();
  clear(root());
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  const email = h('input', { type: 'email', id: 'email-field', autocomplete: 'username' }) as HTMLInputElement;
  email.setAttribute('aria-label', 'Email');
  const password = h('input', { type: 'password', id: 'password-field', autocomplete: 'current-password' }) as HTMLInputElement;
  password.setAttribute('aria-label', 'Password');
  const submit = h('button', { type: 'submit', text: 'Sign in' });
  const form = h(
    'form',
    { class: 'signin-panel', onsubmit: async (ev: Event) => {
      ev.preventDefault();
      const button = submit as HTMLButtonElement;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      announce('Signing in…');
      clearAlert();
      try {
        const result = await api<SessionInfo>('POST', '/api/session', { email: email.value, password: password.value });
        newSession();
        state.session = result.data;
        announce('');
        const target = validNext(next);
        history.replaceState({}, '', target ?? '/board');
        await loadSessionAndRender(target ?? '/board');
      } catch (err) {
        const failure = err as ApiFailure;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        announce('');
        password.value = '';
        if (failure instanceof ApiFailure) {
          showAlert(failure.body.message);
        } else {
          showAlert('Lineboard could not reach the server. Check the connection and try again.');
        }
        email.focus();
      }
    } },
    h('h1', { class: 'display', text: 'Lineboard' }),
    h('label', { for: 'email-field', text: 'Email' }),
    email,
    h('label', { for: 'password-field', text: 'Password' }),
    password,
    submit,
  );
  const alertBox = h('div', { role: 'alert', class: 'alert' });
  root().append(
    h('main', {},
      h('div', { class: 'signin-wrap' }, form),
      alertBox,
    ),
  );
  alertRegion = alertBox;
  statusRegion = null;
  bannerRegion = null;
  email.focus();
}

setUnauthorizedHandler(() => {
  newSession();
  state.session = null;
  state.kitchen = null;
  const path = window.location.pathname;
  if (SCREENS.includes(path)) {
    history.replaceState({}, '', `/?next=${encodeURIComponent(path + window.location.search)}`);
  } else {
    history.replaceState({}, '', '/');
  }
  signInScreen();
});

async function loadSessionAndRender(targetPath: string): Promise<void> {
  const sessionResult = await apiOrNull<SessionInfo>('GET', '/api/session');
  if (!sessionResult) return;
  state.session = sessionResult.data;
  const kitchenResult = await apiOrNull<KitchenInfo>('GET', '/api/kitchen');
  if (!kitchenResult) return;
  state.kitchen = kitchenResult.data;
  state.hourBankMonth = kitchenResult.data.currentMonth;
  if (state.session.user.role === 'member' && state.session.user.memberId) {
    const bank = await apiOrNull<{ balanceHours: number; month: string }>('GET', `/api/members/${state.session.user.memberId}/hour-bank?month=${state.kitchen.currentMonth}`);
    if (bank) state.hourBankBalance = bank.data.balanceHours;
  }
  renderFrame();
  await route(targetPath);
}

function renderFrame(): void {
  boardCleanup();
  clear(root());
  const session = state.session!;
  const kitchen = state.kitchen!;
  const isMember = session.user.role === 'member';
  const menuButton = h('button', { id: 'menu-button', 'aria-expanded': 'false', 'aria-controls': 'menu-panel', text: 'Menu', onclick: () => toggleMenu() });
  const menuPanel = h('div', { id: 'menu-panel', class: 'menu-panel folded' });
  const headerNav = h('nav', { 'aria-label': 'Main' });
  for (const item of NAV_ITEMS[session.user.role]) {
    const go = (ev: Event) => {
      ev.preventDefault();
      history.pushState({}, '', item.path);
      void route(item.path);
    };
    headerNav.append(h('a', { href: item.path, text: item.label, onclick: go }));
    menuPanel.append(h('a', { href: item.path, text: item.label, onclick: go }));
  }
  const signOut = h('button', { text: 'Sign out', onclick: async () => {
    await api('DELETE', '/api/session').catch(() => undefined);
    newSession();
    state.session = null;
    state.kitchen = null;
    history.replaceState({}, '', '/');
    signInScreen();
  } });
  menuPanel.append(signOut);
  const hourBank = isMember
    ? h('div', { class: 'hour-bank', role: 'group', 'aria-label': 'Hour bank', id: 'hour-bank-group' },
        h('span', { class: 'hour-bank-figures display', id: 'hour-bank-figures' }),
        h('span', { class: 'hour-bank-month', id: 'hour-bank-month' }),
      )
    : null;
  root().append(
    h('header', { class: 'app-header' },
      h('div', { class: 'header-row' },
        h('span', { class: 'kitchen-name display', text: kitchen.name }),
        headerNav,
        h('span', { class: 'person-name', text: session.user.name }),
        signOut,
        menuButton,
        hourBank,
      ),
      menuPanel,
    ),
    h('div', { role: 'region', 'aria-label': 'Service status', id: 'service-banner', class: 'service-banner hidden' }),
    h('main', { id: 'main-content' }),
    h('div', { role: 'status', 'aria-live': 'polite', class: 'announcements', id: 'app-status' }),
    h('div', { role: 'alert', class: 'alert', id: 'app-alert' }),
  );
  statusRegion = document.getElementById('app-status');
  alertRegion = document.getElementById('app-alert');
  bannerRegion = document.getElementById('service-banner');
  fetchStatusBanner();
  startBannerPolling();
  updateHourBankFigures();
}

export function updateHourBankFigures(balance?: number, month?: string): void {
  if (balance !== undefined) state.hourBankBalance = balance;
  if (month !== undefined) state.hourBankMonth = month;
  const figures = document.getElementById('hour-bank-figures');
  const monthEl = document.getElementById('hour-bank-month');
  if (figures) figures.textContent = `${hoursText(state.hourBankBalance ?? 0)} h left`;
  if (monthEl) monthEl.textContent = monthName(state.hourBankMonth ?? state.kitchen?.currentMonth ?? '');
}

function toggleMenu(): void {
  const button = document.getElementById('menu-button');
  if (!button) return;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  if (expanded) closeMenu();
  else openMenu();
}

function openMenu(): void {
  const button = document.getElementById('menu-button');
  const panel = document.getElementById('menu-panel');
  if (!button || !panel) return;
  button.setAttribute('aria-expanded', 'true');
  panel.classList.remove('folded');
  const first = panel.querySelector('a');
  if (first) (first as HTMLElement).focus();
}

function closeMenu(): void {
  const button = document.getElementById('menu-button');
  const panel = document.getElementById('menu-panel');
  if (!button || !panel) return;
  button.setAttribute('aria-expanded', 'false');
  panel.classList.add('folded');
  button.focus();
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    const button = document.getElementById('menu-button');
    if (button && button.getAttribute('aria-expanded') === 'true') {
      closeMenu();
    }
  }
});

document.addEventListener('click', (ev) => {
  const button = document.getElementById('menu-button');
  const panel = document.getElementById('menu-panel');
  if (!button || !panel) return;
  if (button.getAttribute('aria-expanded') !== 'true') return;
  const target = ev.target as HTMLElement;
  if (panel.contains(target) || button.contains(target)) return;
  closeMenu();
});

/** A signed-in person opening a screen outside their role lands on the board. */
async function route(targetPath?: string): Promise<void> {
  const path = targetPath ?? window.location.pathname;
  const session = state.session!;
  const allowed = NAV_ITEMS[session.user.role].map((item) => item.path);
  if (!allowed.includes(path)) {
    history.replaceState({}, '', '/board');
    showAlert('That screen is not available for your role.');
    await renderScreen('/board');
    return;
  }
  await renderScreen(path);
}

async function renderScreen(path: string): Promise<void> {
  const main = document.querySelector('main')!;
  clear(main);
  clearAlert();
  switch (path) {
    case '/bookings':
      await renderBookings(main, state);
      break;
    case '/documents':
      await renderDocuments(main, state);
      break;
    case '/invoices':
      await renderInvoices(main, state);
      break;
    case '/reports':
      await renderReports(main, state);
      break;
    case '/sanitation':
      await renderSanitation(main, state);
      break;
    case '/settings':
      await renderSettings(main, state);
      break;
    default:
      await renderBoard(main, state);
      break;
  }
  const menuButton = document.getElementById('menu-button');
  if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
  const panel = document.getElementById('menu-panel');
  if (panel) panel.classList.add('folded');
}

window.addEventListener('popstate', () => {
  if (state.session) void route();
  else void boot();
});

async function renderInspectRoute(): Promise<void> {
  clear(root());
  await renderInspector(root(), window.location.pathname);
}

async function boot(): Promise<void> {
  if (window.location.pathname.startsWith('/inspect/')) {
    await renderInspectRoute();
    return;
  }
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const next = validNext(params.get('next'));
  if (SCREENS.includes(path)) {
    const existing = await apiOrNull<SessionInfo>('GET', '/api/session');
    if (existing) {
      state.session = existing.data;
      const kitchenResult = await apiOrNull<KitchenInfo>('GET', '/api/kitchen');
      if (!kitchenResult) return;
      state.kitchen = kitchenResult.data;
      state.hourBankMonth = kitchenResult.data.currentMonth;
      renderFrame();
      await route(path);
      return;
    }
    history.replaceState({}, '', `/?next=${encodeURIComponent(path + window.location.search)}`);
    signInScreen();
    return;
  }
  // Sign-in address.
  const existing = await apiOrNull<SessionInfo>('GET', '/api/session');
  if (existing) {
    const kitchenResult = await apiOrNull<KitchenInfo>('GET', '/api/kitchen');
    if (!kitchenResult) return;
    state.session = existing.data;
    state.kitchen = kitchenResult.data;
    state.hourBankMonth = kitchenResult.data.currentMonth;
    renderFrame();
    await route(next ?? '/board');
    return;
  }
  signInScreen();
}

void boot();
