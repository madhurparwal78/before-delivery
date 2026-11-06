import { COPY } from '../domain/copy.js';
import { privateCopy } from '../domain/privateCopy.js';
import type { Language } from '../domain/privateCopy.js';
import {
  announce,
  api,
  closeSurface,
  currentScreen,
  go,
  openSurface,
  redraw,
  run,
  setShellDrawer,
  show,
  state,
  surfaceOf,
} from './app.js';
import type { Child } from './dom.js';
import { h, render } from './dom.js';
import {
  bottomBar,
  button,
  field,
  headingNode,
  link,
  menuView,
  playSurfaceEntries,
  problemsRegion,
  refreshLine,
  surfaceView,
} from './ui.js';

const SOLID_DEPTH = 24;

export function headingLinesOf(screen: ReturnType<typeof currentScreen>): string[] {
  return screen?.headingLines?.(state.data) ?? [screen?.heading(state.data) ?? 'Page not found'];
}

let solid = window.scrollY > SOLID_DEPTH;

export function watchScroll(): void {
  const read = (): void => {
    const next = window.scrollY > SOLID_DEPTH;
    if (next !== solid) {
      solid = next;
      redraw();
    }
  };
  window.addEventListener('scroll', read, { passive: true });
  read();
}

/** The public frame: a banner, its links and the heading lines that reveal. */
function publicFrame(screen: ReturnType<typeof currentScreen>): Child[] {
  return [
    h(
      'header',
      {
        key: 'banner',
        class: 'banner',
        role: 'banner',
        'data-solid': solid ? 'true' : 'false',
      },
      h(
        'nav',
        { class: 'banner__links', 'aria-label': 'Site' },
        link('/', 'Noor Bakker Boards', { class: 'link link--mark' }),
        link('/reel', 'Reel'),
        link('/how-it-works', 'How it works'),
        link('/sign-in', 'Sign in'),
      ),
    ),
    mainRegion(screen),
  ];
}

function mainRegion(screen: ReturnType<typeof currentScreen>): Child {
  const language = state.language as Language;
  return h(
    'main',
    { key: 'main', id: 'main', class: 'main' },
    screen?.ownHeading === true ? null : headingNode(headingLinesOf(screen)),
    refreshLine(
      screen?.frame === 'private' ? privateCopy('refreshLine', language) : COPY.refreshFailed,
    ),
    state.sessionEnded && screen?.frame === 'desk' && surfaceOf('Change password') === undefined
      ? h(
          'p',
          { key: 'session-line', class: 'session-line' },
          link('/sign-in', 'Sign in again'),
        )
      : null,
    problemsRegion(state.problems, {
      heading: screen?.frame === 'private' ? privateCopy('problems', language) : 'Problems',
    }),
    ...(screen === null ? [] : screen.view(state.data)),
  );
}

/** From 1100 px a side rail; below it a top bar with a Menu sheet. */
function deskFrame(screen: ReturnType<typeof currentScreen>): Child[] {
  return [
    h(
      'nav',
      { key: 'rail', class: 'rail', 'aria-label': 'Desk' },
      link('/desk/jobs', 'Jobs'),
      link('/desk/clients', 'Clients'),
      link('/desk/calls', 'Calls'),
      button({
        id: 'change-password',
        label: 'Change password',
        onPress: () => openSurface('Change password', 'change-password'),
      }),
      signOutButton('sign-out'),
    ),
    h(
      'div',
      { key: 'top-bar', class: 'top-bar' },
      button({
        id: 'menu',
        label: 'Menu',
        onPress: () => openSurface('Menu', 'menu', { kind: 'sheet', sheet: 'menu' }),
      }),
    ),
    mainRegion(screen),
  ];
}

function signOutButton(id: string): Child {
  return button({
    id,
    label: 'Sign out',
    pendingKey: 'sign-out',
    onPress: () =>
      void run('sign-out', async () => {
        await api('/api/sign-out', { method: 'POST' });
        state.session = null;
        await go('/sign-in');
      }),
  });
}

function menuSheet(): Child {
  const surface = surfaceOf('Menu');
  if (surface === undefined) return null;
  return surfaceView(surface, {
    title: 'Menu',
    body: [
      h(
        'nav',
        { class: 'menu-sheet', 'aria-label': 'Desk' },
        link('/desk/jobs', 'Jobs'),
        link('/desk/clients', 'Clients'),
        link('/desk/calls', 'Calls'),
      ),
      button({
        id: 'menu-change-password',
        label: 'Change password',
        onPress: () => {
          closeSurface('Menu');
          openSurface('Change password', 'menu');
        },
      }),
      signOutButton('menu-sign-out'),
    ],
  });
}

function passwordDialog(): Child {
  const surface = surfaceOf('Change password');
  if (surface === undefined) return null;
  const set = (name: string) => (value: string) => {
    surface.values[name] = value;
    state.drafts[`password-${name}`] = value;
    redraw();
  };
  return surfaceView(surface, {
    title: 'Change password',
    body: [
      problemsRegion(surface.problems, { withLinks: false, message: surface.message }),
      field({
        id: 'currentPassword',
        label: 'Current password',
        kind: 'password',
        autocomplete: 'current-password',
        value: surface.values['currentPassword'] ?? '',
        onInput: set('currentPassword'),
        problem: surface.problems['currentPassword'],
      }),
      field({
        id: 'newPassword',
        label: 'New password',
        kind: 'password',
        autocomplete: 'new-password',
        value: surface.values['newPassword'] ?? '',
        onInput: set('newPassword'),
        problem: surface.problems['newPassword'],
      }),
      state.sessionEnded ? h('p', {}, link('/sign-in', 'Sign in again')) : null,
    ],
    footer: [
      button({
        id: 'save-password',
        label: 'Save',
        kind: 'primary',
        pendingKey: 'password',
        onPress: () =>
          void run('password', async () => {
            await api('/api/password', {
              method: 'POST',
              body: {
                currentPassword: surface.values['currentPassword'] ?? '',
                newPassword: surface.values['newPassword'] ?? '',
              },
            });
            closeSurface('Change password');
            announce(COPY.passwordChanged);
          }),
      }),
    ],
  });
}

export function drawShell(): void {
  const screen = currentScreen();
  const shell = document.getElementById('shell');
  if (shell === null) return;
  document.documentElement.lang = state.language;
  document.documentElement.dir = state.direction;
  shell.className = `shell shell--${screen?.frame ?? 'public'}`;

  const frame =
    screen?.frame === 'desk'
      ? deskFrame(screen)
      : screen?.frame === 'private'
        ? [mainRegion(screen)]
        : publicFrame(screen);

  render(shell, [
    ...frame,
    screen?.frame === 'public' ? null : bottomBar(screen?.mainAction?.(state.data) ?? null),
    menuSheet(),
    passwordDialog(),
    ...state.surfaces
      .filter((surface) => surface.name !== 'Menu' && surface.name !== 'Change password')
      .map((surface) => surfaceContent(surface)),
    menuView(),
  ]);
  playSurfaceEntries();
}

const surfaceDrawers = new Map<string, (surface: ReturnType<typeof surfaceOf>) => Child>();

export function registerSurface(
  name: string,
  drawer: (surface: NonNullable<ReturnType<typeof surfaceOf>>) => Child,
): void {
  surfaceDrawers.set(name, drawer as (surface: ReturnType<typeof surfaceOf>) => Child);
}

function surfaceContent(surface: NonNullable<ReturnType<typeof surfaceOf>>): Child {
  const exact = surfaceDrawers.get(surface.name);
  if (exact !== undefined) return exact(surface);
  for (const [name, drawer] of surfaceDrawers) {
    if (surface.name.startsWith(`${name} `)) return drawer(surface);
  }
  return null;
}

export function startShell(): void {
  setShellDrawer(drawShell);
  watchScroll();
  // A control that receives focus is scrolled fully into view between the bars.
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.surface') === null) {
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.menu !== null) {
      state.menu = null;
      redraw();
      return;
    }
    const open = [...state.surfaces].reverse().find((surface) => surface.phase === 'open');
    if (open !== undefined) closeSurface(open.name);
  });
  document.addEventListener('click', (event) => {
    const anchor = (event.target as Element | null)?.closest('a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const address = anchor.getAttribute('href') ?? '';
    if (
      address === '' ||
      address.startsWith('#') ||
      address.startsWith('http') ||
      anchor.target === '_blank' ||
      anchor.hasAttribute('download')
    ) {
      return;
    }
    event.preventDefault();
    void go(address);
  });
  window.addEventListener('popstate', (event) => {
    const mark = (event.state ?? null) as { scrollY?: number } | null;
    const url = new URL(location.href);
    void show(url.pathname, url.searchParams, {
      wipe: true,
      restoreScroll: mark?.scrollY ?? null,
    });
  });
}
