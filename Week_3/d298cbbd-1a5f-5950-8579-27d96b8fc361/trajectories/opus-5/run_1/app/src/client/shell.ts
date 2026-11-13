import { api } from './api.js';
import { COPY } from './copy.js';
import { clear, el } from './dom.js';
import { state } from './state.js';
import { navigate } from './router.js';

export const FOLDERS: { label: string; path: string }[] = [
  { label: 'Test', path: '/' },
  { label: 'History', path: '/history' },
  { label: 'Boards', path: '/boards' },
  { label: 'Race rooms', path: '/race' },
  { label: 'Settings', path: '/settings' },
];

export function signInHref(): string {
  const here = window.location.pathname;
  return here === '/' || here === '/signin' ? '/signin' : `/signin?from=${encodeURIComponent(here)}`;
}

function accountLinks(): HTMLElement {
  const box = el('div', { class: 'account-links' });
  if (state.session) {
    box.append(el('a', { href: '/account', class: 'link' }, ['Account']));
    const out = el('button', { type: 'button', class: 'button' }, ['Sign out']);
    out.addEventListener('click', () => {
      void api.del('/api/session').then(() => {
        state.session = null;
        renderShell();
        navigate('/');
      });
    });
    box.append(out);
  } else {
    box.append(el('a', { href: signInHref(), class: 'link' }, ['Sign in']));
  }
  return box;
}

/** A session that ended elsewhere leaves the signed-out top row behind. */
export function refreshTopRow(): void {
  const existing = document.querySelector('.account-links');
  existing?.replaceWith(accountLinks());
}

export function renderShell(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('no app root');
  clear(root);

  const drawer = el('div', { class: 'drawer' });
  const top = el('header', { class: 'toprow' }, [
    el('span', { class: 'wordmark' }, [COPY.wordmark]),
    accountLinks(),
  ]);
  const mail = el('div', {
    id: 'mail-status',
    role: 'status',
    'aria-label': 'Mail status',
    class: 'mail-status',
  });
  if (state.mailOutage) mail.textContent = COPY.mailDown;

  const nav = el('nav', { 'aria-label': 'Folders', class: 'folders' });
  const list = el('ul', { class: 'folder-tabs' });
  for (const folder of FOLDERS) {
    const link = el('a', { href: folder.path, class: 'folder-tab' }, [folder.label]);
    if (window.location.pathname === folder.path) link.setAttribute('aria-current', 'page');
    list.append(el('li', {}, [link]));
  }
  nav.append(list);

  drawer.append(top, mail, nav, el('main', { id: 'main' }));
  root.append(drawer, el('footer', { class: 'curtain' }, [COPY.footer]));
}

export function mainElement(): HTMLElement {
  const main = document.getElementById('main');
  if (!main) throw new Error('no main element');
  return main;
}

export function showMailOutage(): void {
  state.mailOutage = true;
  const mail = document.getElementById('mail-status');
  if (mail) mail.textContent = COPY.mailDown;
}

export function clearMailOutage(): void {
  state.mailOutage = false;
  const mail = document.getElementById('mail-status');
  if (mail) mail.textContent = '';
}

export function sheet(className = ''): HTMLElement {
  return el('section', { class: `sheet ${className}`.trim() });
}

export function heading(level: 1 | 2 | 3, text: string): HTMLElement {
  return el(`h${level}` as 'h1' | 'h2' | 'h3', { class: 'heading' }, [text]);
}
