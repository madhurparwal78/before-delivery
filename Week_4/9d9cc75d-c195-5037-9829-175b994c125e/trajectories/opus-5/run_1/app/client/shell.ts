import { send } from './api.js';
import { clear, el } from './dom.js';
import { connectEvents, disconnectEvents, onEvent } from './events.js';
import { loadMe, session } from './session.js';

export type PageRender = (host: HTMLElement, params: Record<string, string>, query: URLSearchParams) => void | Promise<void>;

interface Route {
  parts: string[];
  page: PageRender;
}

const routes: Route[] = [];
let notFoundPage: PageRender = () => undefined;

export function route(pattern: string, page: PageRender): void {
  routes.push({ parts: pattern.split('/').filter((p) => p !== ''), page });
}

export function setNotFound(page: PageRender): void {
  notFoundPage = page;
}

export function navigate(path: string): void {
  if (path === location.pathname + location.search) {
    void render();
    return;
  }
  history.pushState({}, '', path);
  void render();
}

function match(pathname: string): { page: PageRender; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((p) => p !== '');
  for (const candidate of routes) {
    if (candidate.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      const expect = candidate.parts[i];
      if (expect.startsWith(':')) {
        params[expect.slice(1)] = decodeURIComponent(parts[i]);
        continue;
      }
      if (expect !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { page: candidate.page, params };
  }
  return null;
}

function inboxLink(): HTMLElement {
  return el('a', {
    href: '/inbox',
    class: 'header-link',
    'aria-label': `Inbox, ${session.unread} unread`,
    text: `Inbox, ${session.unread} unread`,
  });
}

function header(): HTMLElement {
  const bar = el('header', { class: 'app-header' });
  const left = el('div', { class: 'header-left' }, [
    el('a', { href: '/', class: 'brand', text: 'Lozenge' }),
    el('a', { href: '/workbooks', class: 'header-link', text: 'Workbooks' }),
  ]);
  const right = el('div', { class: 'header-right' });
  if (session.me !== null) {
    right.append(inboxLink());
    const signOut = el('button', { type: 'button', class: 'pill-button', text: 'Sign out' });
    signOut.addEventListener('click', () => {
      void (async () => {
        await send('POST', '/api/auth/logout');
        disconnectEvents();
        await loadMe();
        navigate('/');
      })();
    });
    right.append(signOut);
  } else {
    right.append(el('a', { href: '/signin', class: 'header-link', text: 'Sign in' }));
  }
  bar.append(left, right);
  return bar;
}

let main: HTMLElement | null = null;

export function refreshHeader(): void {
  const app = document.getElementById('app');
  if (app === null) return;
  const old = app.querySelector('.app-header');
  if (old !== null) old.replaceWith(header());
}

export async function render(): Promise<void> {
  const app = document.getElementById('app');
  if (app === null) return;
  clear(app);
  app.append(header());
  main = el('main', { class: 'app-main', id: 'main' });
  app.append(main);
  const found = match(location.pathname);
  const query = new URLSearchParams(location.search);
  if (found === null) {
    await notFoundPage(main, {}, query);
    return;
  }
  await found.page(main, found.params, query);
}

export function startShell(): void {
  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest('a');
    if (target === null || target === undefined) return;
    const href = target.getAttribute('href');
    if (href === null || href.startsWith('http') || target.hasAttribute('download') || href.startsWith('/api/')) return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => {
    void render();
  });
  onEvent('inbox', () => refreshHeader());
  if (session.me !== null) connectEvents();
}
