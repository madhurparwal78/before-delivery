// The app shell: session, banner, drawer, subject and screen mounting.

import { api, announce, navigate, currentAnnouncement } from './core.js';

export interface SessionUser {
  username: string;
  display_name: string;
  roles: string[];
  department: string;
  time_zone: string;
}

interface SessionInfo {
  user: SessionUser;
  workspace: string;
  impersonating: { username: string; display_name: string } | null;
}

const ROLE_PRECEDENCE = ['operator', 'technician', 'approver', 'manager', 'requester'];

let session: SessionInfo | null = null;
let unread = 0;
let storageDown = false;

export function currentUser(): SessionUser | null {
  return session?.user ?? null;
}

export function isSignedIn(): boolean {
  return session !== null;
}

/** A person may open every screen that any one of their roles may open. */
export function mayOpen(path: string): boolean {
  if (path === '/' || path === '/login' || path.startsWith('/not-found')) return true;
  if (!session) return false;
  const roles = session.user.roles;
  const has = (role: string): boolean => roles.includes(role);
  const desk = has('operator') || has('technician');
  const any = has('operator') || has('technician') || has('approver') || has('manager') || has('requester');

  const segments = path.split('/').filter(Boolean);
  const base = '/' + (segments[0] ?? '');

  if (path === '/inbox' || path.startsWith('/portal')) return any;
  if (base === '/desk') {
    if (path.startsWith('/desk/map') || path.startsWith('/desk/major')) return desk || has('manager');
    if (path.startsWith('/desk/changes') || path.startsWith('/desk/boards')) return desk || has('approver');
    if (path.startsWith('/desk/exports')) return desk || has('manager');
    if (path.startsWith('/desk/dashboards')) return desk;
    if (path.startsWith('/desk/oncall') || path === '/pages' || path.startsWith('/desk/runs')) return desk;
    if (path.startsWith('/desk/workflows') || path.startsWith('/desk/admin') || path.startsWith('/desk/config-sets') || path.startsWith('/desk/imports')) return has('operator');
    if (path.startsWith('/desk/records/new/change')) return has('operator');
    if (path.startsWith('/desk/records/new')) return desk;
    return desk || has('approver') || has('manager');
  }
  if (path === '/approve') return has('operator') || has('approver');
  if (path === '/pages') return desk;
  if (base === '/dashboards') return has('operator') || has('manager');
  return false;
}

export function homeScreen(): string {
  const roles = session?.user.roles ?? [];
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) {
      if (role === 'operator' || role === 'technician') return '/desk';
      if (role === 'approver') return '/approve';
      return '/portal';
    }
  }
  return '/portal';
}

export async function refreshSession(): Promise<void> {
  try {
    session = await api<SessionInfo>('/api/session');
  } catch {
    session = null;
  }
  if (session) {
    try {
      const inbox = await api<{ unread: number }>('/api/inbox');
      unread = inbox.unread;
    } catch {
      unread = 0;
    }
  }
  try {
    const status = await api<{ storage: string }>('/api/storage');
    storageDown = status.storage === 'unavailable';
  } catch {
    storageDown = false;
  }
}

export function unreadCount(): number {
  return unread;
}

/** The shell: live region, banner, pinned subject, working sections. */
export function renderShell(subject: string, content: HTMLElement): void {
  const app = document.getElementById('app')!;
  app.textContent = '';

  const live = document.createElement('div');
  live.className = 'ann';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-label', 'Announcements');
  live.textContent = currentAnnouncement();
  app.appendChild(live);

  const banner = document.createElement('header');
  banner.className = 'banner';
  banner.setAttribute('role', 'banner');
  banner.appendChild(wordmarkLink());
  banner.appendChild(menuButton());
  if (session) banner.appendChild(inboxLink());
  if (session?.user.roles.includes('operator')) banner.appendChild(workspaceCombo());
  if (storageDown) banner.appendChild(storageRegion());
  if (session?.impersonating) banner.appendChild(impersonationRegion());
  app.appendChild(banner);

  const subjectEl = document.createElement('section');
  subjectEl.className = 'subject';
  const h = document.createElement('h1');
  h.textContent = subject;
  subjectEl.appendChild(h);
  app.appendChild(subjectEl);

  const edge = document.createElement('div');
  edge.className = 'edge';
  edge.appendChild(content);
  app.appendChild(edge);

  document.body.appendChild(navigationDrawer());
}

function wordmarkLink(): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = 'wordmark';
  a.href = '/';
  a.textContent = 'Ferrocline';
  return a;
}

function menuButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Menu';
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    const drawer = document.querySelector('dialog[aria-label="Navigation"]') as HTMLDialogElement | null;
    if (drawer) {
      drawer.showModal();
      drawer.querySelector('a')?.focus();
      button.setAttribute('aria-expanded', 'true');
    }
  });
  return button;
}

function inboxLink(): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = '/inbox';
  a.textContent = `Inbox, ${unread} unread`;
  return a;
}

function workspaceCombo(): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Workspace');
  for (const [value, label] of [['live', 'Live workspace'], ['test', 'Test workspace']] as Array<[string, string]>) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = session?.workspace === 'test' ? 'test' : 'live';
  select.addEventListener('change', async () => {
    await api('/api/session/workspace', { method: 'PUT', body: JSON.stringify({ workspace: select.value }) });
    if (select.value === 'test') {
      const block = document.createElement('div');
      block.textContent = 'Test workspace';
      block.style.background = '#14161c';
      block.style.color = '#ff6b1a';
      block.style.padding = '8px 16px';
      document.querySelector('.banner')?.after(block);
    }
    announce(select.value === 'test' ? 'Test workspace' : 'Live workspace');
  });
  return select;
}

function storageRegion(): HTMLElement {
  const region = document.createElement('div');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Storage status');
  const desk = session ? (session.user.roles.includes('operator') || session.user.roles.includes('technician')) : false;
  region.textContent = desk
    ? 'File storage is unreachable. Ticket work continues; uploads are queued and exports will retry when storage returns.'
    : 'Attachments are paused while file storage is unreachable. Your request still goes through.';
  return region;
}

function impersonationRegion(): HTMLElement {
  const region = document.createElement('div');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Impersonation');
  const target = session?.impersonating;
  region.textContent = `Impersonating ${target?.display_name} (${target?.username}). Everything you do is recorded.`;
  const stop = document.createElement('button');
  stop.textContent = 'Stop impersonating';
  stop.addEventListener('click', async () => {
    await api('/api/impersonate', { method: 'DELETE' });
    announce('Impersonation stopped.');
    navigate('/desk');
  });
  region.appendChild(stop);
  return region;
}

/** The navigation drawer with links to every screen the person may open. */
function navigationDrawer(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Navigation');
  const nav = document.createElement('nav');
  const links: Array<[string, string]> = [
    ['Desk', '/desk'],
    ['Service map', '/desk/map'],
    ['Change calendar', '/desk/changes/calendar'],
    ['Your votes', '/approve'],
    ['On call', '/desk/oncall'],
    ['Dashboards', '/dashboards/desk-overview'],
    ['Ask the desk', '/portal'],
    ['Inbox', '/inbox'],
  ];
  for (const [label, href] of links) {
    if (!mayOpen(href)) continue;
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    a.addEventListener('click', () => dialog.close());
    nav.appendChild(a);
  }
  dialog.appendChild(nav);
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.addEventListener('click', () => dialog.close());
  dialog.appendChild(close);
  return dialog;
}

/** The published not-found state. */
export function notFoundState(): HTMLElement {
  const section = document.createElement('section');
  const line = document.createElement('p');
  line.className = 'state-line';
  line.textContent = `That page isn't on the switchyard.`;
  const button = document.createElement('button');
  button.className = 'solid';
  button.textContent = 'Back to your desk';
  button.addEventListener('click', () => { location.href = homeScreen(); });
  line.appendChild(button);
  section.appendChild(line);
  return section;
}
