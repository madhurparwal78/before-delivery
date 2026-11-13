import './styles.css';
import { copy } from '../shared/copy';
import { api, ApiFailure } from './api';
import { el, replace } from './dom';
import { mountBoard } from './pages/board';
import { mountBuilder } from './pages/builder';
import { mountHistory } from './pages/history';
import { mountHome } from './pages/home';
import { mountJoin } from './pages/join';
import { leaveRoom, mountRoom } from './pages/room';
import { mountUpload } from './pages/upload';
import { app, clearPageTimers, layoutMode, type LayoutMode, type Player } from './state';
import { openDialog } from './ui/overlay';

const shell = document.getElementById('app') as HTMLElement;
const page = el('main', { class: 'page' });
let currentLayout: LayoutMode = layoutMode();
let currentPath = '';

export function navigate(path: string): void {
  if (path === location.pathname) return;
  history.pushState({}, '', path);
  void route();
}

export function link(
  label: string,
  href: string,
  className: string,
  name?: string,
): HTMLElement {
  return el(
    'a',
    {
      class: className,
      href,
      'aria-label': name ?? null,
      onclick: (event: Event) => {
        event.preventDefault();
        navigate(href);
      },
    },
    [label === '' ? null : label],
  );
}

function logo(): HTMLElement {
  return el(
    'a',
    {
      class: 'tile ink logo',
      href: '/',
      'aria-label': 'Overlap home',
      onclick: (event: Event) => {
        event.preventDefault();
        navigate('/');
      },
    },
    [
      el('span', { class: 'mark' }, [
        el('span', { class: 'mark-square' }),
        el('span', { class: 'mark-square' }),
        el('span', { class: 'mark-square' }),
        el('span', { class: 'mark-square brass' }),
      ]),
    ],
  );
}

function menuDialog(): void {
  openDialog({ name: 'Menu' }, () => [
    el('div', { class: 'tile menu-links' }, [
      link('Board', '/puzzles', 'nav-link'),
      link('Upload', '/upload', 'nav-link'),
      link('History', '/history', 'nav-link'),
      link('Start a room', '/puzzles', 'nav-link'),
    ]),
  ]);
}

function topBar(): HTMLElement {
  if (currentLayout === 'phone') {
    return el('header', { class: 'topbar board' }, [
      logo(),
      el('button', {
        type: 'button',
        class: 'tile menu-button',
        text: 'Menu',
        onclick: menuDialog,
      }),
    ]);
  }
  return el('header', { class: 'topbar board' }, [
    logo(),
    el('nav', { class: 'tile nav' }, [
      link('Board', '/puzzles', 'nav-link'),
      link('Upload', '/upload', 'nav-link'),
      link('History', '/history', 'nav-link'),
    ]),
    link('Start a room', '/puzzles', 'tile ink action'),
  ]);
}

export function sentenceTile(text: string, className = ''): HTMLElement {
  return el('div', { class: `tile sentence ${className}`.trim() }, [el('p', { text })]);
}

export function loadingBoard(): HTMLElement {
  return el('div', { class: 'board loading', 'aria-busy': 'true' }, [
    el('div', { class: 'tile surface wide' }),
    el('div', { class: 'tile surface' }),
    el('div', { class: 'tile surface' }),
  ]);
}

/** The display name dialog creates the player, then the action that needed one runs. */
export async function ensurePlayer(): Promise<Player> {
  if (app.player) return app.player;
  return new Promise((resolve) => {
    const error = el('p', {
      class: 'field-error',
      id: 'display-name-error',
      'aria-live': 'polite',
    });
    const input = el('input', {
      type: 'text',
      class: 'field',
      'aria-label': 'Display name',
      'aria-describedby': 'display-name-error',
    }) as HTMLInputElement;
    const dialog = openDialog({ name: 'Choose a display name', className: 'name-dialog' }, () => {
      const submit = async (): Promise<void> => {
        try {
          const player = await api.createPlayer(input.value);
          app.player = player;
          app.settings = await api.settings();
          dialog.close();
          resolve(player);
        } catch (failure) {
          if (failure instanceof ApiFailure) {
            error.textContent = failure.body.fields?.display_name ?? failure.body.message;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
          }
        }
      };
      return [
        el('div', { class: 'tile dialog-tile' }, [
          el('h2', { text: 'Choose a display name' }),
          input,
          error,
          el('button', {
            type: 'button',
            class: 'button',
            text: 'Continue',
            onclick: () => void submit(),
          }),
        ]),
      ];
    });
  });
}

async function route(): Promise<void> {
  const path = location.pathname;
  if (currentPath.startsWith('/games/') && path !== currentPath) leaveRoom();
  currentPath = path;
  clearPageTimers();
  replace(shell, [topBar(), page]);
  page.replaceChildren();
  if (path === '/') {
    mountHome(page);
    return;
  }
  await ensurePlayer();
  const body = el('div', { class: 'page-body' });
  const loading = loadingBoard();
  page.replaceChildren(loading, body);
  page.setAttribute('aria-busy', 'true');
  const game = /^\/games\/([0-9a-f-]{36})$/.exec(path);
  const join = /^\/g\/([a-z0-9]{12})$/.exec(path);
  if (path === '/puzzles') await mountBoard(body);
  else if (path === '/upload') await mountUpload(body);
  else if (path === '/history') await mountHistory(body);
  else if (path === '/build') mountBuilder(body);
  else if (game) await mountRoom(body, game[1]);
  else if (join) await mountJoin(body, join[1]);
  else body.append(sentenceTile(copy.pageNotFound));
  loading.remove();
  page.removeAttribute('aria-busy');
}

window.addEventListener('popstate', () => {
  void route();
});

window.addEventListener('resize', () => {
  const next = layoutMode();
  if (next === currentLayout) return;
  currentLayout = next;
  document.documentElement.dataset.layout = next;
  void route();
});

async function boot(): Promise<void> {
  document.documentElement.dataset.layout = currentLayout;
  try {
    app.config = await api.config();
  } catch {
    /* the defaults stand in until the config route answers */
  }
  try {
    app.player = await api.me();
    app.settings = await api.settings();
  } catch {
    app.player = null;
  }
  await route();
}

void boot();
