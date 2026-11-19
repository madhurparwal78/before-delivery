import type { MeResponse } from '../shared/types.js';
import { api, failureOf } from './api.js';
import { renderInvitation, renderSignIn, renderSignUp } from './auth.js';
import { clear, el } from './dom.js';
import { renderMarketing } from './marketing.js';
import { liveRegions } from './regions.js';
import { OutlineScreen } from './outline/screen.js';

const app = document.getElementById('app')!;
const mount = el('div', { class: 'page' });
document.body.append(liveRegions());
app.append(mount);

let screen: OutlineScreen | null = null;
let me: MeResponse | null = null;

function go(path: string): void {
  if (path !== `${window.location.pathname}${window.location.search}`) {
    window.history.pushState({}, '', path);
  }
  void route();
}

function viewFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('view') === 'board';
}

function notFoundPage(): void {
  dropScreen();
  clear(mount);
  mount.append(
    el('main', {}, [
      el('section', { class: 'outline-window app-window' }, [
        el('div', { class: 'window-body state-block' }, [
          el('h1', {}, [`We couldn't find that bullet`]),
          el('p', { class: 'muted' }, [`It may have been deleted, or it isn't shared with you.`]),
          el('a', { class: 'pill pill-accent', href: '/' }, ['Back to Home'])
        ])
      ])
    ])
  );
}

function dropScreen(): void {
  screen?.stop();
  screen = null;
}

async function loadMe(): Promise<MeResponse | null> {
  try {
    me = await api.me();
    return me;
  } catch (error) {
    if (failureOf(error)?.status === 401) {
      me = null;
      return null;
    }
    throw error;
  }
}

async function route(): Promise<void> {
  const path = window.location.pathname;
  const search = window.location.search;

  if (path === '/signup' || path === '/signin') {
    dropScreen();
    const params = new URLSearchParams(search);
    const next = params.get('next') ?? '/';
    const prefill = params.get('email') ?? '';
    if (path === '/signup') renderSignUp(mount, go, prefill);
    else renderSignIn(mount, go, next, prefill);
    return;
  }

  if (path.startsWith('/invite/')) {
    dropScreen();
    const token = path.slice('/invite/'.length);
    const signedIn = await loadMe();
    renderInvitation(
      mount,
      { token, signedInEmail: signedIn?.user.email ?? null },
      go,
      notFoundPage
    );
    return;
  }

  const zoomed = path.startsWith('/b/');
  if (path !== '/' && !zoomed) {
    notFoundPage();
    return;
  }

  const account = screen === null ? await loadMe() : me;
  if (account === null) {
    if (zoomed) {
      window.location.href = `/signin?next=${encodeURIComponent(path)}`;
      return;
    }
    dropScreen();
    renderMarketing(mount);
    return;
  }

  const rootId = zoomed ? path.slice('/b/'.length) : null;
  const boardView = viewFromSearch(search);
  if (screen === null) {
    screen = new OutlineScreen(mount, account, { go });
    screen.start(rootId, boardView);
    return;
  }
  screen.show(rootId, boardView);
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const link = (event.target as HTMLElement).closest('a');
  if (link === null) return;
  const href = link.getAttribute('href');
  if (href === null || href.startsWith('#') || link.target === '_blank') return;
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;
  event.preventDefault();
  const target = `${url.pathname}${url.search}`;
  if (screen === null) {
    go(target);
    return;
  }
  void screen.flush().then(() => go(target));
});

window.addEventListener('popstate', () => {
  void route();
});

void route();
