import type { BoardDto, CalendarDto, MeDto } from '../shared/types.js';
import { api, RequestFailed } from './api.js';
import { clear, el } from './dom.js';
import { subscriptionCopy } from './copy.js';
import { todayInZone } from '../shared/time.js';

export type RitualStep = 'pull' | 'estimate' | 'check' | 'timebox' | 'shutdown';

export interface AppState {
  me: MeDto | null;
  board: BoardDto | null;
  calendar: CalendarDto | null;
  stripDate: string | null;
  step: RitualStep;
  openDay: string | null;
  backlogOpen: boolean;
}

export const state: AppState = {
  me: null,
  board: null,
  calendar: null,
  stripDate: null,
  step: 'pull',
  openDay: null,
  backlogOpen: true,
};

let statusRegion: HTMLElement | null = null;
let statusPath: string | null = null;
let pendingAnnouncement: string | null = null;

export function announce(message: string): void {
  if (!statusRegion) {
    pendingAnnouncement = message;
    return;
  }
  statusRegion.textContent = '';
  window.setTimeout(() => {
    if (statusRegion) statusRegion.textContent = message;
  }, 30);
}

/** Keeps an outcome announcement alive across the navigation it triggers. */
export function announceAfterRender(message: string): void {
  pendingAnnouncement = message;
}

export function navigate(path: string): void {
  if (window.location.pathname !== path) window.history.pushState({}, '', path);
  void render();
}

export function focusKeyOf(node: Element | null): string | null {
  if (!(node instanceof HTMLElement)) return null;
  return node.dataset.focusKey ?? null;
}

export function restoreFocus(key: string | null): void {
  if (!key) return;
  const target = document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`);
  if (target) target.focus();
}

type ScreenRenderer = (root: HTMLElement) => void | Promise<void>;

const screens = new Map<string, ScreenRenderer>();

export function registerScreen(path: string, renderer: ScreenRenderer): void {
  screens.set(path, renderer);
}

let joinRenderer: ((root: HTMLElement, token: string) => void | Promise<void>) | null = null;

export function registerJoinScreen(renderer: (root: HTMLElement, token: string) => void | Promise<void>): void {
  joinRenderer = renderer;
}

function masthead(): HTMLElement {
  const me = state.me;
  const links: HTMLElement[] = [];
  const path = window.location.pathname;
  const addLink = (href: string, label: string): void => {
    links.push(
      el('a', { href, 'aria-current': path === href ? 'page' : null, 'data-focus-key': `nav:${href}` }, [label]),
    );
  };

  if (me && me.member.role !== 'operator') {
    addLink('/', 'Daybook');
    addLink('/settings', 'Settings');
    if (me.member.role === 'owner') addLink('/workspace', 'Workspace');
  }
  if (me && me.member.role === 'operator') addLink('/ops', 'Operations');

  const nav = el('nav', { 'aria-label': 'Main', class: 'main-nav' }, links);
  if (me) {
    const signOut = el('button', { type: 'button', class: 'button button--quiet' }, ['Sign out']);
    signOut.addEventListener('click', () => {
      void api
        .signOut()
        .catch(() => undefined)
        .then(() => {
          state.me = null;
          state.board = null;
          navigate('/signin');
        });
    });
    nav.append(signOut);
  }

  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.getAttribute('href') ?? '/');
    });
  }

  return el('header', { class: 'masthead' }, [
    el('div', {}, [
      el('h1', { text: 'Tidemark Daybook' }),
      me?.workspace ? el('span', { class: 'workspace-name', text: me.workspace.name }) : null,
    ]),
    nav,
  ]);
}

function banner(): HTMLElement | null {
  const workspace = state.me?.workspace;
  if (!workspace) return null;
  const copy = subscriptionCopy(workspace);
  if (!copy) return null;
  return el(
    'div',
    { role: 'region', 'aria-label': 'Subscription', class: 'banner', 'data-state': workspace.state },
    [copy],
  );
}

export async function loadMe(): Promise<MeDto | null> {
  try {
    state.me = await api.me();
  } catch {
    state.me = null;
  }
  return state.me;
}

export function localToday(): string {
  const zone = state.me?.member.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return todayInZone(zone);
}

export async function render(): Promise<void> {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;
  const path = window.location.pathname;
  const publicPath = path === '/signin' || path === '/trial' || path.startsWith('/join/');

  if (!state.me && !publicPath) {
    await loadMe();
  }
  if (!state.me && !publicPath) {
    window.history.replaceState({}, '', '/signin');
    return render();
  }
  if (state.me && (path === '/signin' || path === '/trial')) {
    window.history.replaceState({}, '', state.me.member.role === 'operator' ? '/ops' : '/');
    return render();
  }
  if (state.me?.member.role === 'operator' && path !== '/ops') {
    window.history.replaceState({}, '', '/ops');
    return render();
  }

  const carriedStatus = statusPath === window.location.pathname ? (statusRegion?.textContent ?? '') : '';
  statusPath = window.location.pathname;
  clear(root);
  const shell = el('div', { class: 'shell' });
  const page = el('main', { class: 'page' });
  statusRegion = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Planner updates',
    class: 'status-region',
    text: carriedStatus,
  });

  shell.append(masthead());
  const subscription = banner();
  if (subscription) shell.append(subscription);
  shell.append(statusRegion, page);
  root.append(shell);

  const current = window.location.pathname;
  if (current.startsWith('/join/') && joinRenderer) {
    await joinRenderer(page, current.slice('/join/'.length));
  } else {
    const renderer = screens.get(current);
    if (renderer) await renderer(page);
    else page.append(el('h2', { text: 'Not found' }));
  }

  if (pendingAnnouncement !== null) {
    const message = pendingAnnouncement;
    pendingAnnouncement = null;
    announce(message);
  }
}

export function fieldError(error: unknown, field: string): string | null {
  if (error instanceof RequestFailed && error.payload.fields) {
    return error.payload.fields[field] ?? null;
  }
  return null;
}

export function startShellRefresh(): void {
  window.setInterval(() => {
    if (!state.me) return;
    void api
      .me()
      .then((fresh) => {
        const changed =
          fresh.workspace?.state !== state.me?.workspace?.state ||
          fresh.member.timeZone !== state.me?.member.timeZone;
        state.me = fresh;
        if (changed) void render();
        else refreshBanner();
      })
      .catch(() => undefined);
  }, 30_000);
}

function refreshBanner(): void {
  const existing = document.querySelector<HTMLElement>('[aria-label="Subscription"]');
  const workspace = state.me?.workspace;
  const copy = workspace ? subscriptionCopy(workspace) : null;
  if (existing && copy) {
    existing.textContent = copy;
    existing.dataset.state = workspace?.state ?? '';
    return;
  }
  if (existing !== copy) void render();
}
