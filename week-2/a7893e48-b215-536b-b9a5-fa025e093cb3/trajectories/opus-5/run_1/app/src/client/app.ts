import type { ServiceStatus, SessionUser, Site } from '../shared/types.js';
import { api } from './api.js';
import { copy } from './copy.js';
import { clear, el } from './dom.js';
import { icon } from './ui/icons.js';

export interface AppState {
  user: SessionUser | null;
  sites: Site[];
  status: ServiceStatus;
}

export const state: AppState = {
  user: null,
  sites: [],
  status: { billing: 'ok', mail: 'ok', queued_emails: 0 },
};

type Screen = (host: HTMLElement) => void;

const screens = new Map<string, Screen>();
const statusListeners = new Set<() => void>();

export function registerScreen(path: string, screen: Screen): void {
  screens.set(path, screen);
}

export function onStatusChange(listener: () => void): void {
  statusListeners.add(listener);
}

export function billingDelayed(): boolean {
  return state.status.billing === 'delayed';
}

/** Visible-only suffix; the control keeps its accessible name. */
export function delayedLabel(text: string): HTMLElement {
  return el('span', {}, billingDelayed() ? [`${text} `, el('span', { class: 'delayed-mark' }, ['(delayed)'])] : [text]);
}

export function landingPath(user: SessionUser): string {
  if (user.role === 'manager') return '/manage';
  return user.role === 'front_desk' ? '/counter' : '/board';
}

function navLinks(user: SessionUser): { href: string; text: string }[] {
  if (user.role === 'renter') {
    return [
      { href: '/board', text: 'Board' },
      { href: '/tickets', text: 'Tickets' },
      { href: '/pack', text: 'Pack' },
      { href: '/documents', text: 'Documents' },
    ];
  }
  if (user.role === 'front_desk') {
    return [
      { href: '/board', text: 'Board' },
      { href: '/counter', text: 'Counter' },
    ];
  }
  return [
    { href: '/board', text: 'Board' },
    { href: '/counter', text: 'Counter' },
    { href: '/manage', text: 'Manage' },
  ];
}

export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  render();
}

function serviceBanner(): HTMLElement {
  const lines: string[] = [];
  if (state.status.billing === 'delayed') lines.push(copy.billingBanner);
  if (state.status.mail === 'delayed') lines.push(copy.mailBanner);
  const banner = el('div', {
    role: 'status',
    'aria-label': 'Service status',
    'aria-live': 'polite',
    class: lines.length === 0 ? 'service-banner empty' : 'service-banner',
  });
  for (const line of lines) banner.append(el('p', {}, [line]));
  return banner;
}

function topBar(user: SessionUser): HTMLElement {
  const nav = el(
    'nav',
    { 'aria-label': 'Main', class: 'main-nav' },
    navLinks(user).map((link) => {
      const anchor = el(
        'a',
        {
          href: link.href,
          class: window.location.pathname === link.href ? 'nav-link current' : 'nav-link',
        },
        [link.text],
      );
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        navigate(link.href);
      });
      return anchor;
    }),
  );
  const signOut = el('button', { type: 'button', class: 'button quiet' }, ['Sign out']);
  signOut.addEventListener('click', () => {
    void api.delete('/api/session').then(() => {
      state.user = null;
      state.sites = [];
      navigate('/');
    });
  });
  return el('header', { class: 'top-bar' }, [
    el('div', { class: 'brand' }, [
      el('span', { class: 'brand-mark' }, [icon('flame')]),
      el('span', { class: 'brand-name' }, ['Hearthshift']),
    ]),
    nav,
    el('div', { class: 'top-bar-user' }, [
      el('span', { class: 'user-name' }, [user.name]),
      signOut,
    ]),
    serviceBanner(),
  ]);
}

const root = (): HTMLElement => {
  const node = document.getElementById('app');
  if (node === null) throw new Error('missing app root');
  return node;
};

export function render(): void {
  const host = root();
  clear(host);
  const user = state.user;
  const path = window.location.pathname;
  if (user === null) {
    const screen = screens.get('/');
    if (screen !== undefined) screen(host);
    return;
  }
  host.append(topBar(user));
  const main = el('main', { class: `screen screen-${path.slice(1) === '' ? 'board' : path.slice(1)}` });
  host.append(main);
  const screen = screens.get(path === '/' ? landingPath(user) : path);
  if (screen === undefined) {
    navigate(landingPath(user));
    return;
  }
  screen(main);
}

async function pollStatus(): Promise<void> {
  const result = await api.get<ServiceStatus>('/api/status');
  if (!result.ok) return;
  const changed =
    result.data.billing !== state.status.billing || result.data.mail !== state.status.mail;
  state.status = result.data;
  if (changed) {
    render();
    for (const listener of statusListeners) listener();
  } else {
    const banner = document.querySelector('[aria-label="Service status"]');
    if (banner !== null) banner.replaceWith(serviceBanner());
  }
}

export async function loadSites(): Promise<void> {
  const result = await api.get<{ sites: Site[] }>('/api/sites');
  state.sites = result.ok ? result.data.sites : [];
}

export async function start(): Promise<void> {
  const me = await api.get<{ user: SessionUser }>('/api/me');
  if (me.ok) {
    state.user = me.data.user;
    await loadSites();
  }
  window.addEventListener('popstate', () => render());
  void pollStatus();
  window.setInterval(() => void pollStatus(), 8_000);
  if (state.user !== null && window.location.pathname === '/') {
    navigate(landingPath(state.user));
    return;
  }
  render();
}
