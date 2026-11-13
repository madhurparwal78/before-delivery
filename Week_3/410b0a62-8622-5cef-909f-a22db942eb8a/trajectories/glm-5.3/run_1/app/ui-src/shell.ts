import { api, type LinkJson, type Me } from './api.js';
import { h, clear } from './dom.js';

export type Route =
  | { name: 'sign-in' }
  | { name: 'home'; athleteId: string; week: string | null }
  | { name: 'builder'; athleteId: string; date: string | null; workout: string | null }
  | { name: 'workout'; workoutId: string }
  | { name: 'coach' }
  | { name: 'plans' }
  | { name: 'inbox' }
  | { name: 'coaches' }
  | { name: 'not-found' };

export function parseRoute(path: string): Route {
  const [rawPath, search] = path.split('?');
  const pathname = rawPath ?? '/';
  const params = new URLSearchParams(search ?? '');
  if (pathname === '/sign-in') return { name: 'sign-in' };
  if (pathname === '/' || pathname === '') return { name: 'home', athleteId: '', week: null };
  const mHome = /^\/athletes\/([^/]+)$/.exec(pathname);
  if (mHome !== null) return { name: 'home', athleteId: mHome[1] ?? '', week: params.get('week') };
  const mBuilder = /^\/athletes\/([^/]+)\/builder$/.exec(pathname);
  if (mBuilder !== null) {
    return {
      name: 'builder',
      athleteId: mBuilder[1] ?? '',
      date: params.get('date'),
      workout: params.get('workout'),
    };
  }
  const mWorkout = /^\/workouts\/([^/]+)$/.exec(pathname);
  if (mWorkout !== null) return { name: 'workout', workoutId: mWorkout[1] ?? '' };
  if (pathname === '/coach') return { name: 'coach' };
  if (pathname === '/plans') return { name: 'plans' };
  if (pathname === '/inbox') return { name: 'inbox' };
  if (pathname === '/coaches') return { name: 'coaches' };
  return { name: 'not-found' };
}

export interface AppCtx {
  me: Me | null;
  athletes: { id: string; name: string }[];
  notices: HTMLElement;
  reloadHeader: () => Promise<void>;
  navigate: (to: string, replace?: boolean) => void;
}

export function header(ctx: AppCtx): HTMLElement {
  const bar = h('header', { class: 'topbar', role: 'banner' });
  const brand = h('a', { class: 'brand', href: '/' }, 'Tempoline');
  const nav = h('nav', { class: 'topnav', 'aria-label': 'Main' });

  const switcher = h('select', { class: 'switcher', 'aria-label': 'Athlete' }) as HTMLSelectElement;
  if (ctx.me !== null && ctx.me.role === 'coach' && ctx.athletes.length > 0) {
    switcher.classList.add('visible');
    for (const athlete of ctx.athletes) {
      switcher.append(h('option', { value: athlete.id }, athlete.name));
    }
    const current = /\/athletes\/([^/]+)/.exec(window.location.pathname);
    if (current) switcher.value = current[1] ?? '';
    switcher.addEventListener('change', () => {
      window.location.href = `/athletes/${switcher.value}`;
    });
  }

  const notices = h('div', { class: 'notices-inner', id: 'notices', role: 'status' });
  const signOut = h('button', { class: 'pill pill-ghost', onclick: doSignOut }, 'Sign out');
  const menuButton = h('button', {
    class: 'menu-button',
    onclick: () => openDrawer(ctx),
    'aria-haspopup': 'dialog',
  }, 'Menu');

  bar.append(brand, nav, switcher, notices, signOut, menuButton);
  renderNav(ctx, nav);
  return bar;
}

async function doSignOut(event: Event): Promise<void> {
  const btn = event.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Signing out…';
  await api.post('/auth/sign-out');
  window.location.href = '/sign-in';
}

function renderNav(ctx: AppCtx, nav: HTMLElement): void {
  clear(nav);
  if (!ctx.me) return;
  if (ctx.me.role === 'athlete') {
    nav.append(
      link('Calendar', `/athletes/${ctx.me.id}`),
      link('Builder', `/athletes/${ctx.me.id}/builder`),
      link('Coaches', '/coaches')
    );
  } else {
    nav.append(link('Athletes', '/coach'), link('Plans', '/plans'), link('Inbox', '/inbox'));
  }
}

function link(label: string, href: string): HTMLElement {
  const active = window.location.pathname === href.split('?')[0];
  return h('a', { class: active ? 'navlink active' : 'navlink', href }, label);
}

function openDrawer(ctx: AppCtx): void {
  const existing = document.getElementById('menu-drawer');
  if (existing) existing.remove();
  const items: [string, string][] = ctx.me?.role === 'athlete'
    ? [
        ['Calendar', ctx.me ? `/athletes/${ctx.me.id}` : '/'],
        ['Builder', ctx.me ? `/athletes/${ctx.me.id}/builder` : '/'],
        ['Coaches', '/coaches'],
      ]
    : [
        ['Athletes', '/coach'],
        ['Plans', '/plans'],
        ['Inbox', '/inbox'],
      ];
  const list = h('div', { class: 'drawer-list' }, ...items.map(([label, href]) => h('a', { class: 'drawer-link', href }, label)));
  const dialog = h('div', {
    id: 'menu-drawer',
    class: 'dialog drawer',
    role: 'dialog',
    'aria-label': 'Menu',
  }, list);
  document.body.append(dialog);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dialog.remove();
    if (e.key === 'Tab') trapTab(e as KeyboardEvent, dialog);
  });
  const first = dialog.querySelector<HTMLElement>('a, button');
  first?.focus();
}

function trapTab(e: KeyboardEvent, container: HTMLElement): void {
  const focusable = Array.from(container.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea'));
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function drawerVisible(): boolean {
  return document.getElementById('menu-drawer') !== null;
}

export function notify(ctx: AppCtx, text: string): void {
  const node = ctx.notices;
  node.textContent = text;
}

export async function loadLinks(): Promise<LinkJson[]> {
  const res = await api.get<{ links: LinkJson[] }>('/links');
  return res.links;
}
