// Strongroom Ledger: page chrome, routing between screens, the live stream, the outage banner and drafts.
import { call, get, onAnswer } from './api.js';
import { announce, h, icon } from './dom.js';
import { mountLedger } from './ledger.js';
import { mountRules } from './rules.js';
import { mountBreaches, mountBreach, mountHolding } from './records.js';
import { mountAccount, mountContact } from './contact.js';

const OUTAGE = 'Sign-in service unavailable. Your ledger still works; signing in, changing passwords and granting access are paused.';
const DRAFT_KEY = 'strongroom-draft';
const STATUS_POLL_MS = 30000;
const PHONE = matchMedia('(max-width: 599.98px)');

const NAV = [['/vault', 'Ledger'], ['/vault/breaches', 'Breaches'], ['/vault/rules', 'Rules'],
  ['/vault/contact', 'Trusted contact'], ['/vault/account', 'Account']];

const ROUTES = [
  [/^\/vault$/, mountLedger],
  [/^\/vault\/holdings\/([^/]+)$/, mountHolding],
  [/^\/vault\/breaches$/, mountBreaches],
  [/^\/vault\/breaches\/([^/]+)$/, mountBreach],
  [/^\/vault\/rules$/, mountRules],
  [/^\/vault\/contact$/, mountContact],
  [/^\/vault\/account$/, mountAccount],
  [/^\/shared$/, mountLedger],
];

/** What every screen shares: who is signed in, the kinds, today's server date, the statuses and navigation. */
export const app = {
  me: null,
  kinds: [],
  kindLabel: {},
  today: document.body.dataset.today,
  screen: null,
  exposureStatus: null,
  draftStatus: null,
  navigate,
  sessionEnded,
  saveDraft,
  takeDraft,
  get isOwner() { return this.me?.role === 'owner'; },
};

const banner = h('div', { class: 'banner-slot' });
let main = null;
let screenRoot = null;

function currentPath() {
  return location.pathname + location.search;
}

// --------------------------------------------------------------------------- outage banner

async function checkStatus() {
  const answer = await get('/api/status');
  if (answer.status !== 200) return;
  if (answer.body.identity === 'down') {
    if (!banner.firstChild) {
      banner.append(h('div', { class: 'banner', role: 'alert' }, icon('alert'), h('p', { text: OUTAGE })));
    }
  } else {
    banner.replaceChildren();
  }
}

onAnswer((status) => { if (status === 503) checkStatus(); });

// --------------------------------------------------------------------------- drafts

function saveDraft(draft) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, path: currentPath(), email: app.me?.email }));
}

/** The one-use draft for this screen, if any; a draft from another account is dropped unread. */
function takeDraft(kind) {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const draft = JSON.parse(raw);
  if (draft.email !== app.me?.email) {
    sessionStorage.removeItem(DRAFT_KEY);
    return null;
  }
  if (draft.kind !== kind || draft.path !== currentPath()) return null;
  sessionStorage.removeItem(DRAFT_KEY);
  return draft;
}

/** A covered save answered 401: keep the entries, then sign in again and come back to this screen. */
function sessionEnded(draft) {
  if (draft) saveDraft(draft);
  location.assign(`/auth/login?next=${encodeURIComponent(currentPath())}`);
}

// --------------------------------------------------------------------------- chrome

function topBar() {
  const home = app.isOwner ? '/vault' : '/shared';
  const wordmark = h('a', { class: 'wordmark', href: home, 'aria-label': 'Hollowmere, Strongroom Ledger home' },
    mark(), h('span', { text: 'Hollowmere' }));
  const signOut = h('button', { type: 'button', class: 'button button-quiet', onclick: signOutNow },
    icon('exit'), h('span', { text: 'Sign out' }));
  if (!app.isOwner) return h('header', { class: 'topbar' }, wordmark, h('div', { class: 'topbar-end' }, signOut));
  const links = NAV.map(([href, label]) => h('li', {}, h('a', { href, class: 'nav-link', text: label })));
  const nav = h('nav', { class: 'nav', id: 'vault-nav', 'aria-label': 'Vault' }, h('ul', {}, links));
  const menu = h('button', {
    type: 'button', class: 'button button-quiet menu-button', 'aria-expanded': 'false', 'aria-controls': 'vault-nav',
    onclick: () => setMenu(nav.classList.contains('open') ? false : true),
  }, icon('menu'), h('span', { text: 'Menu' }));
  const setMenu = (open) => {
    nav.classList.toggle('open', open);
    menu.setAttribute('aria-expanded', String(open));
  };
  nav.addEventListener('click', (event) => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('open') && PHONE.matches) {
      setMenu(false);
      menu.focus();
    }
  });
  PHONE.addEventListener('change', () => setMenu(false));
  return h('header', { class: 'topbar' }, wordmark, nav, h('div', { class: 'topbar-end' }, menu, signOut));
}

function mark() {
  return h('svg', { class: 'mark', viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false' },
    h('rect', { svg: true, x: '3', y: '3', width: '26', height: '26', rx: '3' }),
    h('circle', { svg: true, cx: '16', cy: '16', r: '7.5' }),
    h('path', { svg: true, d: 'M16 8.5v4M16 19.5v4M8.5 16h4M19.5 16h4' }),
    h('circle', { svg: true, cx: '16', cy: '16', r: '1.6', class: 'mark-core' }));
}

function markCurrent() {
  for (const link of document.querySelectorAll('.nav-link')) {
    const href = link.getAttribute('href');
    const here = href === '/vault' ? location.pathname === '/vault' || location.pathname.startsWith('/vault/holdings')
      : location.pathname.startsWith(href);
    if (here) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

async function signOutNow() {
  sessionStorage.removeItem(DRAFT_KEY);
  await call('POST', '/auth/logout', {});
  location.assign('/');
}

// --------------------------------------------------------------------------- routing

function render() {
  app.screen?.destroy?.();
  app.screen = null;
  markCurrent();
  const route = ROUTES.find(([pattern]) => pattern.test(location.pathname));
  screenRoot.replaceChildren();
  if (!route) {
    notFound();
    return;
  }
  const params = location.pathname.match(route[0]).slice(1);
  app.screen = route[1](screenRoot, ...params);
}

export function notFound() {
  app.screen?.destroy?.();
  app.screen = null;
  document.title = 'Not found · Strongroom Ledger';
  screenRoot.replaceChildren(h('section', { class: 'notice' },
    h('h1', { text: 'Not found' }), h('p', { text: 'This record does not exist or is not in your view.' }),
    h('p', {}, h('a', { class: 'button button-primary', href: app.isOwner ? '/vault' : '/shared', text: 'Back to ledger' }))));
}

function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link || !main || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !ROUTES.some(([pattern]) => pattern.test(url.pathname))) return;
  event.preventDefault();
  if (url.pathname + url.search !== currentPath()) navigate(url.pathname + url.search);
});

window.addEventListener('popstate', () => {
  if (app.screen?.samePath?.(location.pathname)) app.screen.popstate();
  else render();
});

// --------------------------------------------------------------------------- live stream

function openStream() {
  const stream = new EventSource('/api/events');
  stream.addEventListener('change', (event) => app.screen?.live?.(JSON.parse(event.data)));
  stream.addEventListener('access-ended', () => {
    stream.close();
    app.screen?.accessEnded?.();
  });
  stream.addEventListener('error', () => {
    // A refused reconnect (signed out, idle or ended) closes for good; the screen stays exactly as it is.
    if (stream.readyState === EventSource.CLOSED) app.screen?.streamClosed?.();
  });
}

// --------------------------------------------------------------------------- start

async function start() {
  const page = document.body.dataset.page;
  document.body.prepend(banner);
  checkStatus();
  setInterval(checkStatus, STATUS_POLL_MS);
  if (page === 'home' || page === 'notice' || page === 'unavailable') return;
  const [me, kinds] = await Promise.all([get('/api/me'), get('/api/kinds')]);
  if (me.status !== 200) {
    if (page !== 'not-found') location.assign(`/?next=${encodeURIComponent(currentPath())}`);
    return;
  }
  app.me = me.body;
  if (kinds.status === 200) {
    app.kinds = kinds.body.kinds;
    app.kindLabel = Object.fromEntries(kinds.body.kinds.map((k) => [k.code, k.label]));
  }
  const root = document.getElementById('root');
  screenRoot = h('div', { class: 'screen-root' });
  main = h('main', { id: 'main', class: 'main' });
  if (app.isOwner) {
    app.exposureStatus = h('p', { role: 'status', 'aria-label': 'Exposure updates', class: 'ticker' });
    app.draftStatus = h('p', { role: 'status', 'aria-label': 'Draft restored', class: 'ticker ticker-draft' });
    main.append(h('div', { class: 'tickers' }, app.exposureStatus, app.draftStatus));
  }
  main.append(screenRoot);
  root.replaceChildren(topBar(), main);
  if (page === 'not-found') {
    notFound();
    return;
  }
  render();
  openStream();
}

export function announceExposure(message) {
  if (app.exposureStatus) announce(app.exposureStatus, message);
}

start();
