import { api, ApiError } from './api.js';
import { h, qs, announce, openDialog } from './ui.js';
import { fmtDateTime, fmtDateOnly } from '../shared/bases.js';

export interface Member {
  id: string;
  name: string;
  role: Role;
  workspaceSlug: string;
  workspaceName: string;
  yachtSlug?: string | null;
}

export type Role = 'fleet_director' | 'charter_manager' | 'finance_lead' | 'captain' | 'crew_member';

export let member: Member | null = null;

export async function loadSession(): Promise<Member | null> {
  try {
    const res = await api<{ member: Member }>('/api/session');
    member = res.member;
    return res.member;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.body?.error === 'access_removed') {
      member = null;
      return null;
    }
    member = null;
    return null;
  }
}

export const NAV: Array<{ path: string; label: string; roles: Role[] }> = [
  { path: '/w/%ws%/today', label: 'Today', roles: ['fleet_director', 'captain', 'crew_member'] },
  { path: '/w/%ws%/fleet', label: 'Fleet', roles: ['fleet_director', 'charter_manager', 'finance_lead', 'captain', 'crew_member'] },
  { path: '/w/%ws%/holds', label: 'Holds', roles: ['fleet_director', 'charter_manager', 'finance_lead'] },
  { path: '/w/%ws%/charters', label: 'Charters', roles: ['fleet_director', 'charter_manager', 'finance_lead', 'captain'] },
  { path: '/w/%ws%/passages', label: 'Passages', roles: ['fleet_director', 'captain', 'crew_member'] },
  { path: '/w/%ws%/berths', label: 'Berths', roles: ['fleet_director', 'captain'] },
  { path: '/w/%ws%/shore-power', label: 'Shore power', roles: ['fleet_director', 'captain'] },
  { path: '/w/%ws%/brokers', label: 'Brokers', roles: ['fleet_director', 'charter_manager'] },
  { path: '/w/%ws%/tariffs', label: 'Tariffs', roles: ['fleet_director', 'finance_lead'] },
];

export function homePath(role: Role, ws: string): string {
  if (role === 'fleet_director') return `/w/${ws}/fleet`;
  if (role === 'charter_manager') return `/w/${ws}/holds`;
  if (role === 'finance_lead') return `/w/${ws}/charters`;
  return `/w/${ws}/today`;
}

export function renderStaffShell(currentPath: string, children: Node[]): HTMLElement {
  const ws = member!.workspaceSlug;
  const links = NAV.filter((n) => n.roles.includes(member!.role)).map((n) =>
    h('a', { href: n.path.replace('%ws%', ws), 'aria-current': currentPath === n.path.replace('%ws%', ws) ? 'page' : null }, n.label),
  );
  const nav = h('nav', { 'aria-label': 'Workspace' }, links.length > 0 ? links : document.createTextNode(''));
  const menuBtn = h('button', { class: 'menu-btn', 'aria-haspopup': 'dialog' }, 'Menu');
  menuBtn.addEventListener('click', () => {
    openDialog('Menu', (panel, ctrl) => {
      const close = () => ctrl.close();
      panel.append(
        h('div', { class: 'menulinks', style: 'display:flex;flex-direction:column;gap:0.4rem' },
          ...links.map((l) => h('a', { href: (l as HTMLAnchorElement).href, style: 'padding:0.6rem 0.4rem;border-radius:8px;text-decoration:none' }, l.textContent ?? '')),
          h('button', { class: 'danger', onclick: () => { close(); void signOut(); } }, 'Sign out'),
        ),
      );
    });
  });
  const bar = h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: homePath(member!.role, ws) }, 'Tidewright'),
    h('span', { class: 'wsname' }, member!.workspaceName),
    nav,
    menuBtn,
    h('button', { class: 'signout', onclick: () => void signOut() }, 'Sign out'),
  );
  return h('div', {}, bar, ...children) as HTMLElement;
}

export async function signOut(): Promise<void> {
  await api('/api/session', { method: 'DELETE' });
  member = null;
  location.href = '/sign-in';
}

/** A session-ended or removed-access banner with Sign in again. */
export function sessionBanner(err: ApiError): HTMLElement {
  const body = err.body ?? {};
  const kind = body.error === 'access_removed' ? 'removed' : 'ended';
  const text = kind === 'removed'
    ? 'Your access to this workspace was removed. Ask your fleet director if this is a mistake.'
    : 'Your session has ended. Sign in again — what you typed is kept.';
  return h('div', { class: 'msg err', role: 'alert' },
    h('span', {}, text + ' '),
    h('a', { href: `/sign-in?returnTo=${encodeURIComponent(location.pathname + location.search)}` }, 'Sign in again'),
  );
}

export function isSessionError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 401;
}

export { fmtDateTime, fmtDateOnly };
