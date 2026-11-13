import type { Profile } from '../shared/types.js';
import { api } from './api.js';
import { OFFLINE_COPY, type AppContext } from './app.js';
import { clear, el } from './dom.js';
import { mountCloset } from './pages/closet.js';
import { mountImports } from './pages/imports.js';
import { mountSettings } from './pages/settings.js';
import { mountSignIn } from './pages/signin.js';
import { mountTrips } from './pages/trips.js';
import { mountWorkspace } from './pages/workspace.js';
import { cache, saveCache } from './store.js';

const root = document.getElementById('app') as HTMLElement;
const reconnectListeners = new Set<() => void>();
let profile: Profile | null = cache.profile;
let offline = !navigator.onLine;
let openImportDialog = false;

const connection = el('div', { class: 'connection', role: 'status', 'aria-label': 'Connection' });
const page = el('main', { class: 'page' });

const context: AppContext = {
  profile: () => profile as Profile,
  setProfile: (next) => {
    profile = next;
    cache.profile = next;
    saveCache();
  },
  navigate: (path, options = {}) => {
    openImportDialog = options.openImport === true;
    if (options.replace === true) window.history.replaceState({}, '', path);
    else window.history.pushState({}, '', path);
    void render();
  },
  signedOut: () => {
    window.history.pushState({}, '', '/sign-in');
    void render();
  },
  offline: () => offline,
  setOffline: (next) => {
    const wanted = next || !navigator.onLine;
    if (offline === wanted) return;
    next = wanted;
    offline = next;
    paintConnection();
    if (!next) for (const listener of reconnectListeners) listener();
  },
  onReconnect: (listener) => {
    reconnectListeners.add(listener);
  },
};

function paintConnection(): void {
  connection.textContent = offline ? OFFLINE_COPY : '';
  connection.classList.toggle('visible', offline);
}

function header(): HTMLElement {
  const link = (label: string, href: string): HTMLAnchorElement => {
    const node = el('a', { href, class: 'nav-link' }, [label]);
    node.addEventListener('click', (event) => {
      event.preventDefault();
      context.navigate(href);
    });
    return node;
  };
  const signOut = el('button', { type: 'button', class: 'sign-out' }, ['Sign out']);
  signOut.addEventListener('click', () => {
    void api('DELETE', '/api/session').then(() => {
      context.signedOut();
    });
  });
  return el('header', { class: 'app-header' }, [
    el('div', { class: 'brand' }, ['Skinout']),
    el('nav', { class: 'nav', 'aria-label': 'Main' }, [
      link('Closet', '/closet'),
      link('Trips', '/trips'),
      link('Imports', '/imports'),
      link('Settings', '/settings'),
    ]),
    signOut,
  ]);
}

async function loadProfile(): Promise<boolean> {
  const result = await api<{ profile: Profile }>('GET', '/api/profile');
  if (result.ok) {
    context.setProfile(result.data.profile);
    context.setOffline(false);
    return true;
  }
  if (result.offline) {
    context.setOffline(true);
    return profile !== null;
  }
  return false;
}

async function render(): Promise<void> {
  const path = window.location.pathname;
  if (path === '/') {
    window.history.replaceState({}, '', '/trips');
    void render();
    return;
  }
  if (path === '/sign-in') {
    clear(root);
    root.append(connection, page);
    paintConnection();
    clear(page);
    mountSignIn(page, context);
    return;
  }
  if (!(await loadProfile())) {
    window.history.replaceState({}, '', '/sign-in');
    void render();
    return;
  }
  if (root.querySelector('.app-header') === null) {
    clear(root);
    root.append(header(), connection, page);
  }
  paintConnection();
  clear(page);
  const listMatch = /^\/lists\/([^/]+)$/.exec(path);
  if (path === '/closet') mountCloset(page, context);
  else if (path === '/trips') mountTrips(page, context);
  else if (path === '/imports') mountImports(page, context, openImportDialog);
  else if (path === '/settings') mountSettings(page, context);
  else if (listMatch !== null) mountWorkspace(page, context, listMatch[1] as string);
  else page.append(el('p', { class: 'notice' }, ['Not found.']));
  openImportDialog = false;
}

window.addEventListener('popstate', () => {
  void render();
});
window.addEventListener('online', () => {
  context.setOffline(false);
});
window.addEventListener('offline', () => {
  context.setOffline(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

void render();
