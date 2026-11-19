/**
 * The poster shell: the banner, the one live region, the navigation drawer, the
 * workspace switch and the published banners. Screens render into its body.
 */

import { api, live, type LiveMessage } from './api';
import { copy } from './copy';
import { button, el, focus, focusableWithin, link, section } from './dom';

export interface SessionUser {
  readonly username: string;
  readonly display_name: string;
  readonly roles: readonly string[];
  readonly department: string | null;
  readonly time_zone: string;
}

export interface SessionState {
  readonly user: SessionUser | null;
  readonly workspace: 'live' | 'test';
  readonly impersonating: { username: string; display_name: string } | null;
  readonly actor: { username: string; display_name: string } | null;
}

export const state: {
  session: SessionState;
  unread: number;
  storage: 'available' | 'unavailable';
  cartCount: number;
} = {
  session: { user: null, workspace: 'live', impersonating: null, actor: null },
  unread: 0,
  storage: 'available',
  cartCount: 0,
};

const rolePrecedence = ['operator', 'technician', 'approver', 'manager', 'requester'] as const;

const homeScreens: Record<string, string> = {
  operator: '/desk',
  technician: '/desk',
  approver: '/approve',
  manager: '/portal',
  requester: '/portal',
};

/** A person's home screen is the home of their first role in the precedence. */
export function homeScreen(): string {
  const roles = state.session.user?.roles ?? [];
  for (const role of rolePrecedence) {
    if (roles.includes(role)) return homeScreens[role];
  }
  return '/login';
}

export function hasRole(...roles: string[]): boolean {
  const mine = state.session.user?.roles ?? [];
  return roles.some((role) => mine.includes(role));
}

export function signedIn(): boolean {
  return state.session.user !== null;
}

/**
 * The published role-to-screen table. A person may open every screen any one of
 * their roles may open; an unknown path is not a screen at all.
 */
const screenRules: readonly { pattern: RegExp; roles: readonly string[] | 'anyone' }[] = [
  { pattern: /^\/$/, roles: 'anyone' },
  { pattern: /^\/login$/, roles: 'anyone' },
  { pattern: /^\/portal(\/.*)?$/, roles: ['operator', 'technician', 'requester', 'approver', 'manager'] },
  { pattern: /^\/inbox$/, roles: ['operator', 'technician', 'requester', 'approver', 'manager'] },
  { pattern: /^\/desk$/, roles: ['operator', 'technician', 'approver', 'manager'] },
  { pattern: /^\/desk\/lists\/[^/]+$/, roles: ['operator', 'technician', 'approver', 'manager'] },
  { pattern: /^\/desk\/records\/new\/(incident|problem|task)$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/records\/new\/change$/, roles: ['operator'] },
  { pattern: /^\/desk\/records\/[^/]+$/, roles: ['operator', 'technician', 'approver', 'manager'] },
  { pattern: /^\/desk\/map$/, roles: ['operator', 'technician', 'manager'] },
  { pattern: /^\/desk\/major\/[^/]+$/, roles: ['operator', 'technician', 'manager'] },
  { pattern: /^\/desk\/changes\/calendar$/, roles: ['operator', 'technician', 'approver'] },
  { pattern: /^\/desk\/boards\/[^/]+$/, roles: ['operator', 'technician', 'approver'] },
  { pattern: /^\/approve$/, roles: ['operator', 'approver'] },
  { pattern: /^\/desk\/oncall$/, roles: ['operator', 'technician'] },
  { pattern: /^\/pages$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/runs\/[^/]+$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/dashboards\/[^/]+$/, roles: ['operator', 'technician'] },
  { pattern: /^\/desk\/exports$/, roles: ['operator', 'technician', 'manager'] },
  { pattern: /^\/dashboards\/[^/]+$/, roles: ['operator', 'manager'] },
  { pattern: /^\/desk\/workflows\/[^/]+$/, roles: ['operator'] },
  { pattern: /^\/desk\/admin\/[^/]+$/, roles: ['operator'] },
  { pattern: /^\/desk\/config-sets$/, roles: ['operator'] },
  { pattern: /^\/desk\/imports$/, roles: ['operator'] },
];

export type ScreenOutcome = 'public' | 'allowed' | 'redirect' | 'not_found';

/** What this visitor gets for a path. */
export function screenOutcome(path: string): ScreenOutcome {
  const rule = screenRules.find((candidate) => candidate.pattern.test(path));
  if (!rule) return 'not_found';
  if (rule.roles === 'anyone') return 'public';
  if (!signedIn()) return 'redirect';
  return hasRole(...rule.roles) ? 'allowed' : 'not_found';
}

let announcer: HTMLElement | null = null;
let bodyHost: HTMLElement | null = null;
let bannerHost: HTMLElement | null = null;

/** Every async result is announced as plain text in the one status region. */
export function announce(text: string): void {
  if (!announcer) return;
  announcer.textContent = text;
}

export function announcement(): string {
  return announcer?.textContent ?? '';
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export interface DrawerLink {
  readonly label: string;
  readonly href: string;
}

/** The drawer links only to screens the signed-in person may open. */
export function drawerLinks(): DrawerLink[] {
  const links: DrawerLink[] = [];
  if (!signedIn()) return [{ label: 'Sign in', href: '/login' }];
  if (hasRole('operator', 'technician', 'approver', 'manager')) {
    links.push({ label: 'Your desk', href: '/desk' });
  }
  if (hasRole('operator', 'technician', 'manager')) links.push({ label: 'Service map', href: '/desk/map' });
  if (hasRole('operator', 'technician', 'approver')) {
    links.push({ label: 'Change calendar', href: '/desk/changes/calendar' });
    links.push({ label: 'Change board', href: '/desk/boards/Change board' });
  }
  if (hasRole('operator', 'approver')) links.push({ label: 'Your votes', href: '/approve' });
  if (hasRole('operator', 'technician')) {
    links.push({ label: 'On call', href: '/desk/oncall' });
    links.push({ label: 'Pages', href: '/pages' });
    links.push({ label: 'Desk overview', href: '/desk/dashboards/desk-overview' });
  }
  if (hasRole('operator', 'manager')) {
    links.push({ label: 'Department standing', href: '/dashboards/department-standing' });
  }
  if (hasRole('operator', 'technician', 'manager')) links.push({ label: 'Exports', href: '/desk/exports' });
  if (hasRole('operator')) {
    links.push({ label: 'Business rules', href: '/desk/admin/business-rules' });
    links.push({ label: 'Access rules', href: '/desk/admin/access-rules' });
    links.push({ label: 'Users', href: '/desk/admin/users' });
    links.push({ label: 'Configuration sets', href: '/desk/config-sets' });
    links.push({ label: 'Imports', href: '/desk/imports' });
    links.push({ label: 'Workflows', href: '/desk/workflows/Laptop fulfilment' });
  }
  links.push({ label: 'Ask the desk', href: '/portal' });
  links.push({ label: 'Inbox', href: '/inbox' });
  return links;
}

let drawer: HTMLElement | null = null;
let drawerOpener: HTMLElement | null = null;

/**
 * A closed drawer is removed from view, from the Tab order and from the
 * accessibility tree until it is opened again.
 */
export function openDrawer(opener: HTMLElement): void {
  if (drawer) return;
  drawerOpener = opener;
  const node = el('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Navigation' }, [
    el('div', { class: 'row' }, [
      el('h2', { class: 'display' }, ['Menu']),
      button('Close', { onclick: '' }),
    ]),
    el('nav', {}, [
      el(
        'ul',
        {},
        drawerLinks().map((item) => el('li', {}, [link(item.label, item.href)])),
      ),
    ]),
  ]);
  const close = node.querySelector('button');
  close?.addEventListener('click', () => closeDrawer());
  node.addEventListener('click', (event) => {
    if (event.target instanceof HTMLAnchorElement) closeDrawer();
  });
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }
    trapTab(event, node);
  });
  document.body.append(node);
  drawer = node;
  focus(close);
}

export function closeDrawer(): void {
  if (!drawer) return;
  drawer.remove();
  drawer = null;
  focus(drawerOpener);
  drawerOpener = null;
}

/** In any open dialog or sheet, Tab and Shift+Tab wrap, so focus never leaves. */
export function trapTab(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const items = focusableWithin(root);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    focus(last);
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    focus(first);
  }
}

export interface DialogOptions {
  readonly label: string;
  readonly sheet?: boolean;
  readonly onClose?: () => void;
}

export interface OpenDialog {
  readonly node: HTMLElement;
  readonly body: HTMLElement;
  close(): void;
}

export function openDialog(
  options: DialogOptions,
  build: (dialog: OpenDialog) => void,
): OpenDialog {
  const opener = document.activeElement as HTMLElement | null;
  const body = section({ class: 'stackv' });
  const node = el('div', { class: `scrim${options.sheet ? ' sheet' : ''}` }, [
    el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.label }, [body]),
  ]);
  const dialog: OpenDialog = {
    node,
    body,
    close: () => {
      node.remove();
      options.onClose?.();
      focus(opener);
    },
  };
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return;
    }
    trapTab(event, node);
  });
  node.addEventListener('mousedown', (event) => {
    if (event.target === node) dialog.close();
  });
  build(dialog);
  document.body.append(node);
  focus(focusableWithin(node)[0] ?? body);
  return dialog;
}

function workspaceCombobox(): HTMLElement {
  const select = el('select', { 'aria-label': 'Workspace' }, [
    el('option', { value: 'live' }, ['Live workspace']),
    el('option', { value: 'test' }, ['Test workspace']),
  ]) as HTMLSelectElement;
  select.value = state.session.workspace;
  select.addEventListener('change', () => {
    void api
      .put('/api/session/workspace', { workspace: select.value })
      .then(() => loadSession())
      .then(() => window.dispatchEvent(new PopStateEvent('popstate')));
  });
  return select;
}

function renderBanner(): HTMLElement {
  const host = el('header', { class: 'banner', role: 'banner' });
  host.append(link('Ferrocline', '/', { class: 'wordmark' }));
  const right = section({ class: 'banner-right' });
  if (signedIn()) {
    if (hasRole('operator')) right.append(workspaceCombobox());
    right.append(link(`Inbox, ${state.unread} unread`, '/inbox'));
  }
  const menu = button('Menu');
  menu.addEventListener('click', () => openDrawer(menu));
  right.append(menu);
  host.append(right);
  return host;
}

function renderBanners(): HTMLElement {
  const host = section({ class: 'stackv' });
  if (state.session.workspace === 'test' && hasRole('operator')) {
    host.append(el('div', { class: 'notice' }, ['Test workspace']));
  }
  if (state.session.impersonating) {
    const region = el('div', { class: 'notice', role: 'region', 'aria-label': 'Impersonation' }, [
      el('span', {}, [
        copy.impersonating(
          state.session.impersonating.display_name,
          state.session.impersonating.username,
        ),
      ]),
    ]);
    const stop = button('Stop impersonating');
    stop.addEventListener('click', () => {
      void api.delete('/api/impersonate').then(async () => {
        await loadSession();
        navigate('/desk');
      });
    });
    region.append(stop);
    host.append(region);
  }
  if (state.storage === 'unavailable') {
    const isPortal = location.pathname.startsWith('/portal');
    host.append(
      el('div', { class: 'notice', role: 'region', 'aria-label': 'Storage status' }, [
        isPortal && !hasRole('operator', 'technician') ? copy.storagePortal : copy.storageDesk,
      ]),
    );
  }
  return host;
}

export function mount(): { body: HTMLElement; refreshChrome: () => void } {
  const root = document.getElementById('root');
  if (!root) throw new Error('No root');
  root.replaceChildren();

  announcer = el('div', { class: 'announce', role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements' });
  bannerHost = section();
  bodyHost = section({ class: 'stackv', style: 'flex:1; min-height:0; display:flex; flex-direction:column;' });
  root.append(announcer, bannerHost, bodyHost);

  const refreshChrome = (): void => {
    if (!bannerHost) return;
    bannerHost.replaceChildren(renderBanner(), renderBanners());
  };
  refreshChrome();
  return { body: bodyHost, refreshChrome };
}

export function bodyHostOf(): HTMLElement {
  if (!bodyHost) throw new Error('Not mounted');
  return bodyHost;
}

export async function loadSession(): Promise<void> {
  try {
    const result = await api.get<SessionState>('/api/session');
    state.session = result;
  } catch {
    state.session = { user: null, workspace: 'live', impersonating: null, actor: null };
  }
}

export async function loadChrome(): Promise<void> {
  if (!signedIn()) return;
  try {
    const inbox = await api.get<{ unread: number }>('/api/inbox');
    state.unread = inbox.unread;
  } catch {
    state.unread = 0;
  }
  try {
    const storage = await api.get<{ storage: 'available' | 'unavailable' }>('/api/storage');
    state.storage = storage.storage;
  } catch {
    state.storage = 'available';
  }
}

/** The pinned subject: one name in the display face on the orange field. */
export function pin(subject: string, extras: (Node | string | null)[] = []): HTMLElement {
  return el('div', { class: 'pin' }, [
    el('h1', { class: 'display subject' }, [subject]),
    ...extras,
  ]);
}

export function restSection(children: (Node | string | null)[], attrs: Record<string, string> = {}): HTMLElement {
  return el('div', { class: 'rest hard-edge', ...attrs }, children);
}

/** One pinned line in the display face over the orange field, plus one button. */
export function stateScreen(line: string, buttonLabel: string, onPress: () => void): HTMLElement {
  const action = button(buttonLabel, { class: 'block' });
  action.addEventListener('click', onPress);
  return el('div', { class: 'state' }, [
    el('p', { class: 'display state-line' }, [line]),
    el('div', {}, [action]),
  ]);
}

export function notFoundScreen(): HTMLElement {
  return stateScreen(copy.notFound, copy.notFoundButton, () => navigate(homeScreen()));
}

/** F6 moves focus to the next region, so focus is never trapped on a page. */
export function installRegionKeys(host: HTMLElement): void {
  host.addEventListener('keydown', (event) => {
    if (event.key !== 'F6') return;
    const regions = [...host.querySelectorAll<HTMLElement>('[data-region]')];
    if (regions.length === 0) return;
    event.preventDefault();
    const active = document.activeElement as HTMLElement | null;
    const index = regions.findIndex((region) => active && region.contains(active));
    const step = event.shiftKey ? -1 : 1;
    const next = regions[(index + step + regions.length) % regions.length];
    focus(focusableWithin(next)[0] ?? next);
  });
}

const screenListeners: (() => void)[] = [];

/**
 * Subscribes to the topics a screen needs. The listener is dropped when the
 * next screen renders, so a screen left behind never speaks again.
 */
export function onLive(
  topics: readonly string[],
  listener: (message: LiveMessage) => void,
): void {
  live.connect();
  live.subscribe([...topics]);
  screenListeners.push(live.on(listener));
}

export function dropScreenListeners(): void {
  while (screenListeners.length > 0) screenListeners.pop()?.();
}
