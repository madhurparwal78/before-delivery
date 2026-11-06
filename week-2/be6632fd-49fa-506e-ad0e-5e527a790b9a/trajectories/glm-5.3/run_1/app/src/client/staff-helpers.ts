// Shared helpers for staff screens: session bootstrap, header and small fallbacks.
import { api, type MemberOut, NAV_BY_ROLE } from './api.js';
import { el, buttonEl } from './ui.js';
import { notFoundScreen } from './router.js';

let member: MemberOut | null = null;

export async function ensureMember(): Promise<MemberOut | null> {
  if (member) return member;
  try {
    const res = await api<{ member: MemberOut }>('GET', '/api/auth/session');
    member = res.data?.member ?? null;
  } catch { member = null; }
  return member;
}

export function currentMember(): MemberOut | null { return member; }

export function clearMember(): void { member = null; }

export function renderHeader(activeHref: string): HTMLElement | null {
  const header = document.getElementById('header');
  if (!header) return null;
  header.replaceChildren();
  if (!member) return null;
  const nav = el('nav', { 'aria-label': 'Studio' });
  for (const item of NAV_BY_ROLE[member.role] ?? []) {
    nav.append(el('a', { href: item.href, text: item.label, ...(item.href === activeHref ? { 'aria-current': 'page' } : {}) }));
  }
  const out = buttonEl({ text: 'Sign out', onclick: async () => {
    await api('POST', '/api/auth/sign-out');
    member = null;
    const { navigate } = await import('./router.js');
    await navigate('/sign-in', { wipe: true });
  } });
  const wrap = el('header', { class: 'staff-header' });
  wrap.append(el('span', { class: 'ws-name', text: 'Hourline' }), nav, el('span', { class: 'spacer' }), out);
  header.append(wrap);
  return wrap;
}

export function renderAuthNeeded(root: HTMLElement, path: string): HTMLElement {
  const h = el('h1', {}, 'Sign in');
  root.append(el('div', { class: 'panel' }, h,
    el('p', { text: 'Your session ended. Sign in again to continue — your draft is kept.' }),
    el('a', { class: 'btn btn-primary', href: `/sign-in?next=${encodeURIComponent(path)}`, text: 'Sign in again' })));
  return h;
}

export function renderForbidden(root: HTMLElement): HTMLElement {
  const h = el('h1', {}, 'Not available');
  root.append(el('div', { class: 'panel' }, h, el('p', { text: "Your role can't do this." })));
  return h;
}

export function renderNotFoundScreen(root: HTMLElement): HTMLElement {
  const screen = notFoundScreen();
  root.append(screen);
  return screen as HTMLElement;
}
