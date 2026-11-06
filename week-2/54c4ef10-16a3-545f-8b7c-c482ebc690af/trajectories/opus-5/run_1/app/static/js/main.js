// The shell: top bar, Activity region, storage banner and the router.
import * as api from './api.js';
import { COPY } from './boot.js';
import { clear, el } from './dom.js';
import { discardDraft } from './drafts.js';
import * as archive from './screens/archive.js';
import * as auth from './screens/auth.js';
import * as curves from './screens/curves.js';
import * as landing from './screens/landing.js';
import * as log from './screens/log.js';
import * as notFound from './screens/notfound.js';
import * as rollForm from './screens/rollform.js';
import * as rollPage from './screens/roll.js';
import * as workspace from './screens/workspace.js';

const UUID = '[0-9a-fA-F-]{36}';

const ROUTES = [
  [new RegExp('^/$'), landing],
  [new RegExp('^/signin$'), auth],
  [new RegExp('^/signup$'), auth],
  [new RegExp('^/archive$'), archive],
  [new RegExp('^/curves$'), curves],
  [new RegExp('^/log$'), log],
  [new RegExp('^/rolls/new$'), rollForm],
  [new RegExp(`^/rolls/(${UUID})/edit$`), rollForm],
  [new RegExp(`^/rolls/(${UUID})/scans/(${UUID})$`), workspace],
  [new RegExp(`^/rolls/(${UUID})$`), rollPage],
];

export const app = {
  account: null,
  storageOk: true,
  activityNode: null,
  bannerHost: null,
  main: null,
  pendingActivity: null,
};

export function activity(message) {
  if (!app.activityNode) {
    app.pendingActivity = message;
    return;
  }
  app.activityNode.textContent = message;
}

export function navigate(path, options = {}) {
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  return route();
}

export async function refreshAccount() {
  try {
    app.account = await api.call('GET', '/api/me', undefined, { keepSession: true });
  } catch {
    app.account = null;
  }
  return app.account;
}

function signedOutHeader() {
  return el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      el('a', { href: '/', class: 'wordmark', text: 'Edgeprint' }),
      navigation(),
    ]),
  ]);
}

function navigation() {
  return el('nav', { role: 'navigation', 'aria-label': 'Main' }, [
    el('a', { href: '/archive', text: 'Archive' }),
    el('a', { href: '/curves', text: 'Curves' }),
    el('a', { href: '/log', text: 'Log' }),
  ]);
}

function signedInHeader() {
  return el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      el('a', { href: '/', class: 'wordmark', text: 'Edgeprint' }),
      navigation(),
    ]),
    el('button', {
      type: 'button',
      class: 'ghost',
      text: 'Sign out',
      onclick: signOut,
    }),
  ]);
}

export async function signOut() {
  try {
    await api.call('POST', '/api/auth/signout', {}, { keepSession: true });
  } finally {
    app.account = null;
    discardDraft();
    await navigate('/');
  }
}

export function storageBanner() {
  return el('div', { role: 'alert', class: 'banner' }, [
    el('p', { text: COPY.banner }),
    el('button', {
      type: 'button',
      class: 'solid',
      text: 'Check again',
      onclick: async () => {
        const ok = await api.storageState();
        if (ok) route();
      },
    }),
  ]);
}

function renderShell() {
  const root = document.getElementById('app');
  clear(root);
  app.activityNode = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Activity',
    class: 'activity',
  });
  app.bannerHost = el('div', { class: 'banner-host' });
  app.main = el('main', { class: 'screen' });
  root.append(app.bannerHost, app.activityNode, app.main);
  if (app.pendingActivity) {
    app.activityNode.textContent = app.pendingActivity;
    app.pendingActivity = null;
  }
}

function paintBanner() {
  clear(app.bannerHost);
  if (app.account && !app.storageOk) app.bannerHost.append(storageBanner());
}

export async function route() {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  let screen = notFound;
  let params = [];
  for (const [pattern, module] of ROUTES) {
    const match = pattern.exec(path);
    if (match) {
      screen = module;
      params = match.slice(1);
      break;
    }
  }
  clear(app.main);
  const context = {
    params,
    query,
    path,
    navigate,
    activity,
    account: app.account,
    storageOk: app.storageOk,
  };
  const header = app.account ? signedInHeader() : signedOutHeader();
  const body = await screen.render(context);
  clear(app.main);
  if (screen !== landing) app.main.append(header);
  app.main.append(body);
  paintBanner();
  document.title = 'Edgeprint';
}

function interceptLinks() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey) return;
    const url = new URL(link.href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    navigate(url.pathname + url.search);
  });
  window.addEventListener('popstate', () => route());
}

api.on('unauthenticated', () => {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  app.account = null;
  navigate(`/signin?next=${next}`);
});

api.on('storage', (down) => {
  app.storageOk = !down;
  paintBanner();
});

async function boot() {
  renderShell();
  interceptLinks();
  await refreshAccount();
  if (app.account) await api.storageState();
  await route();
}

boot();
