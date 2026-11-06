import { del, get, isIdle, onSessionEnded, whenIdle } from './api.ts';
import { el, fontsSettled, replace } from './dom.ts';
import { Region, SESSION_COPY } from './feedback.ts';
import { startLive, stopLive } from './live.ts';

export interface User {
  readonly id: string;
  readonly name: string;
  readonly handle: string;
  readonly role: 'owner' | 'kiln_tech' | 'member';
  readonly studio: { readonly slug: string; readonly name: string; readonly time_zone: string };
}

interface Studio {
  readonly name: string;
  readonly slug: string;
  readonly time_zone: string;
  readonly today: string;
  readonly pickup_window_days: number;
  readonly storage_fee_cents: number;
}

export type Cleanup = () => void;

export interface ScreenContext {
  readonly mount: HTMLElement;
  readonly user: User | null;
  readonly params: Record<string, string>;
  readonly navigate: (path: string, replaceEntry?: boolean) => void;
}

export type ScreenRender = (context: ScreenContext) => Cleanup | void | Promise<Cleanup | void>;

interface RouteEntry {
  readonly pattern: string;
  readonly render: ScreenRender;
  readonly needsUser: boolean;
}

const NAV_LINKS: Record<User['role'], readonly { label: string; path: string }[]> = {
  member: [
    { label: 'My pieces', path: '/pieces' },
    { label: 'Log a piece', path: '/pieces/new' },
    { label: 'Credit', path: '/credit' },
  ],
  kiln_tech: [
    { label: 'Intake', path: '/intake' },
    { label: 'Planner', path: '/planner' },
  ],
  owner: [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Planner', path: '/planner' },
    { label: 'Intake', path: '/intake' },
    { label: 'Rates', path: '/rates' },
    { label: 'Members', path: '/members' },
    { label: 'Reports', path: '/reports' },
    { label: 'Settings', path: '/settings' },
  ],
};

export function homePath(role: User['role']): string {
  if (role === 'member') return '/pieces';
  if (role === 'kiln_tech') return '/intake';
  return '/dashboard';
}

const routes: RouteEntry[] = [];
let currentUser: User | null = null;
let currentStudio: Studio | null = null;
let cleanup: Cleanup | null = null;
let signInFallback: ScreenRender | null = null;

const sessionRegion = new Region('Session status');
const shell = el('div', { class: 'shell' });
const topbar = el('header', { class: 'topbar' });
const screen = el('main', { class: 'screen', id: 'screen' });

export function registerRoute(pattern: string, render: ScreenRender, needsUser = true): void {
  routes.push({ pattern, render, needsUser });
}

export function registerSignIn(render: ScreenRender): void {
  signInFallback = render;
}

function user(): User | null {
  return currentUser;
}

export function studio(): Studio | null {
  return currentStudio;
}

export function setUser(next: User | null): void {
  currentUser = next;
  if (next) startLive();
  else stopLive();
  drawTopbar();
}

export async function refreshStudio(): Promise<void> {
  currentStudio = currentUser ? await get<Studio>('/api/studio').catch(() => null) : null;
}

function drawTopbar(): void {
  if (!currentUser) {
    replace(topbar, [el('span', { class: 'studio-name', text: 'KILN DESK' })]);
    return;
  }
  const nav = el('nav', { 'aria-label': 'Main', class: 'nav' });
  for (const link of NAV_LINKS[currentUser.role]) {
    const anchor = el('a', {
      href: link.path,
      class: location.pathname === link.path ? 'nav-link current' : 'nav-link',
      text: link.label,
      'aria-current': location.pathname === link.path ? 'page' : null,
    });
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.path);
    });
    nav.appendChild(anchor);
  }
  const signOut = el('button', {
    type: 'button',
    class: 'btn ghost sign-out',
    'aria-label': 'Sign out',
    text: 'SIGN OUT',
  });
  signOut.addEventListener('click', () => void signOutNow());
  replace(topbar, [
    el('span', { class: 'studio-name', text: currentUser.studio.name.toUpperCase() }),
    nav,
    signOut,
  ]);
}

async function signOutNow(): Promise<void> {
  await del('/api/session').catch(() => undefined);
  setUser(null);
  currentStudio = null;
  navigate('/signin');
}

function matchRoute(path: string): { entry: RouteEntry; params: Record<string, string> } | null {
  const parts = path.split('/');
  for (const entry of routes) {
    const pattern = entry.pattern.split('/');
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < pattern.length; index += 1) {
      const expected = pattern[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) params[expected.slice(1)] = actual;
      else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (ok) return { entry, params };
  }
  return null;
}

function navigate(path: string, replaceEntry = false): void {
  if (replaceEntry) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  void render(path);
}

function enterSessionEnded(): void {
  currentUser = null;
  currentStudio = null;
  stopLive();
  drawTopbar();
  cleanup?.();
  cleanup = null;
  sessionRegion.say(SESSION_COPY);
  if (signInFallback) {
    void signInFallback({ mount: screen, user: null, params: {}, navigate });
  }
}

async function render(path: string): Promise<void> {
  cleanup?.();
  cleanup = null;
  const normalised = path === '/' ? '' : path;
  const target = normalised === '' ? null : matchRoute(normalised);

  if (!target) {
    if (currentUser) {
      navigate(homePath(currentUser.role), true);
      return;
    }
    const me = await get<{ user: User }>('/api/me').catch(() => null);
    if (me) {
      setUser(me.user);
      await refreshStudio();
      navigate(homePath(me.user.role), true);
      return;
    }
    navigate('/signin', true);
    return;
  }

  if (target.entry.needsUser && !currentUser) {
    const me = await get<{ user: User }>('/api/me').catch(() => null);
    if (!me) {
      navigate('/signin', true);
      return;
    }
    setUser(me.user);
    await refreshStudio();
  }
  sessionRegion.clear();
  drawTopbar();
  replace(screen, []);
  const seq = ++renderSeq;
  screen.style.visibility = 'hidden';
  const done = await target.entry.render({
    mount: screen,
    user: currentUser,
    params: target.params,
    navigate,
  });
  cleanup = typeof done === 'function' ? done : null;
  void revealSettled(seq);
}

let renderSeq = 0;

/** A new screen shows once its first data and fonts have landed, so nothing shifts as it fills. It waits on the
 *  requests themselves, not on timers, and a 3 s timer is only a fallback for a request that never settles. */
async function revealSettled(seq: number): Promise<void> {
  const settled = (async () => {
    await fontsSettled(screen);
    for (let round = 0; round < 20 && seq === renderSeq; round += 1) {
      await whenIdle();
      // let the screen's own code after each answer run, since it may start the next request
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
      if (isIdle()) break;
    }
  })();
  const fallback = new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
  await Promise.race([settled, fallback]);
  if (seq === renderSeq) screen.style.visibility = '';
}

export function startApp(): void {
  document.body.appendChild(shell);
  shell.appendChild(topbar);
  shell.appendChild(sessionRegion.node);
  shell.appendChild(screen);
  drawTopbar();
  onSessionEnded(enterSessionEnded);
  window.addEventListener('popstate', () => void render(location.pathname));
  void render(location.pathname);
}
