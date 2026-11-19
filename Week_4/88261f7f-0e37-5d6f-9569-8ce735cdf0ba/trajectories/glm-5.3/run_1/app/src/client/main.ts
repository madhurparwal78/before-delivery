import { ApiRequest, errorText } from './api.js';
import { el, status, roleHome } from './ui.js';
import type { SessionUser, Role, DeskData } from './types.js';
import { renderSignIn } from './signin.js';
import { renderDesk } from './desk.js';
import { renderBoard } from './board.js';
import { renderGuests } from './guests.js';
import { renderRates } from './rates.js';
import { renderReports } from './reports.js';
import { renderCheckinPage } from './checkin.js';

export interface App {
  root: HTMLElement;
  user: SessionUser | null;
  liveNoticeTo: ((notice: string | null) => void) | null;
  refreshDesk: (() => void) | null;
  refreshBoard: (() => void) | null;
  refreshReports: (() => void) | null;
}

export const app: App = {
  root: null as unknown as HTMLElement,
  user: null,
  liveNoticeTo: null,
  refreshDesk: null,
  refreshBoard: null,
  refreshReports: null
};

let liveSource: EventSource | null = null;
let deskNoticeText: string | null = null;
let deskNoticeNode: HTMLElement | null = null;

export function setDeskNotice(text: string): void {
  deskNoticeText = text;
  if (deskNoticeNode) deskNoticeNode.textContent = text;
}

export function rememberDeskNotice(text: string): void {
  deskNoticeText = text;
}

export function registerDeskNotice(node: HTMLElement | null): void {
  deskNoticeNode = node;
  if (node && deskNoticeText !== null) node.textContent = deskNoticeText;
}

export async function startLive(): Promise<void> {
  if (liveSource) liveSource.close();
  liveSource = new EventSource('/api/live');
  liveSource.addEventListener('change', ev => {
    const data = JSON.parse((ev as MessageEvent).data);
    if (data.notice) {
      setDeskNotice(data.notice);
      rememberDeskNotice(data.notice);
    }
    const kind = data.type as string;
    if (kind === 'room' && app.refreshBoard) app.refreshBoard();
    if (kind === 'room' && app.refreshDesk) app.refreshDesk();
    if (kind === 'stay' && app.refreshDesk) app.refreshDesk();
    if (kind === 'checkin' && app.refreshDesk) app.refreshDesk();
    if (kind === 'close') {
      if (app.refreshDesk) app.refreshDesk();
      if (app.refreshBoard) app.refreshBoard();
    }
    if (kind === 'merge' && window.location.pathname.startsWith('/guests')) {
      route();
    }
    if (kind === 'report' && app.refreshReports) app.refreshReports();
    if ((kind === 'stay' || kind === 'close') && window.location.pathname.startsWith('/reports')) {
      if (app.refreshReports) app.refreshReports();
    }
    if ((kind === 'stay' || kind === 'checkin') && window.location.pathname.startsWith('/guests')) {
      // guests lists do not change with stays
    }
  });
}

export function stopLive(): void {
  if (liveSource) { liveSource.close(); liveSource = null; }
}

const roleAllowed: Record<string, Role[]> = {
  '/desk': ['owner', 'front_desk'],
  '/board': ['owner', 'front_desk', 'housekeeper'],
  '/guests': ['owner', 'front_desk'],
  '/rates': ['owner'],
  '/reports': ['owner']
};

function showNotFound(): void {
  app.root.replaceChildren(el('main', {}, el('h1', { text: 'Page not found.' })));
}

export async function route(): Promise<void> {
  const path = window.location.pathname;
  if (path.startsWith('/checkin/')) {
    renderCheckinPage(app.root, path.slice('/checkin/'.length));
    return;
  }
  if (path === '/') {
    if (app.user) { navigate(roleHome[app.user.role]); return; }
    renderSignIn(app.root, async user => {
      app.user = user;
      await startLive();
      navigate(roleHome[user.role]);
    });
    return;
  }
  if (!app.user) {
    navigate('/');
    return;
  }
  const allowed = roleAllowed[path];
  if (!allowed || !allowed.includes(app.user.role)) {
    showNotFound();
    return;
  }
  if (path === '/desk') await renderDesk(app);
  else if (path === '/board') await renderBoard(app);
  else if (path === '/guests') await renderGuests(app);
  else if (path === '/rates') await renderRates(app);
  else if (path === '/reports') await renderReports(app);
  else showNotFound();
}

export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  route();
}

export async function signOut(): Promise<void> {
  await ApiRequest.del('/api/session');
  app.user = null;
  stopLive();
  navigate('/');
}

export function shell(content: HTMLElement, opts: { hideNav?: boolean } = {}): HTMLElement {
  const nav = el('nav', { 'aria-label': 'Main' });
  const links: Array<[string, string, Role[]]> = [
    ['Desk', '/desk', ['owner', 'front_desk']],
    ['Guests', '/guests', ['owner', 'front_desk']],
    ['Rates', '/rates', ['owner']],
    ['Reports', '/reports', ['owner']],
    ['Board', '/board', ['owner', 'front_desk', 'housekeeper']]
  ];
  if (!opts.hideNav && app.user) {
    for (const [label, path, roles] of links) {
      if (!roles.includes(app.user.role)) continue;
      const a = el('a', { href: path, text: label });
      if (window.location.pathname === path) a.classList.add('current');
      a.addEventListener('click', ev => { ev.preventDefault(); navigate(path); });
      nav.append(a);
    }
  }
  const signOutBtn = el('button', { text: 'Sign out' });
  signOutBtn.addEventListener('click', signOut);
  const bar = el('div', { class: 'topbar' },
    el('span', { class: 'brand', text: 'Nightroll' }),
    nav,
    el('span', { class: 'spacer' }),
    app.user ? el('span', { text: app.user.name }) : null,
    signOutBtn
  );
  const main = el('main', {}, content);
  return el('div', {}, bar, main);
}

export async function boot(): Promise<void> {
  app.root = document.getElementById('app') as HTMLElement;
  const res = await ApiRequest.get('/api/session');
  if (res.status === 200) app.user = res.data.user;
  window.addEventListener('popstate', route);
  await route();
  if (app.user) await startLive();
}

export async function loadDeskData(): Promise<DeskData | null> {
  const res = await ApiRequest.get('/api/desk');
  if (res.status !== 200) return null;
  return res.data as DeskData;
}

void boot();
