// The one router. Every session change lands on a published page, and the
// safe-next rule lives here.

import * as session from './session.js';
import * as api from './api.js';
import { clear, el } from './dom.js';
import { clearStatus } from './status.js';

const MARKETING_PAGES = {
  '/': 'home',
  '/business-banking': 'businessBanking',
  '/business-payments': 'businessPayments',
  '/credit': 'credit',
  '/treasury': 'treasury',
  '/invoicing': 'invoicing',
  '/spend-management': 'spendManagement',
  '/payroll': 'payroll',
  '/books': 'books',
  '/venture-debt': 'ventureDebt',
  '/working-capital-loans': 'workingCapitalLoans',
  '/pricing': 'pricing',
  '/contact': 'contact',
  '/demo': 'demo',
  '/login': 'login',
  '/signup': 'signup',
};

const COCKPIT_PAGES = {
  '/app': 'home',
  '/payments': 'payments',
  '/payments/new': 'sendPayment',
  '/payments/recipients': 'recipients',
  '/payments/recipients/new': 'newRecipient',
  '/approvals': 'approvals',
  '/invoices': 'invoices',
  '/loans': 'loans',
  '/cards': 'cards',
  '/treasury-account': 'treasuryAccount',
  '/bill-pay': 'billPay',
};

const SAFE_NEXT_ROOTS = ['app', 'payments', 'approvals', 'invoices', 'loans'];

// `next` is honoured only when it names a safe cockpit path on this origin.
export function safeNext(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!value.startsWith('/') || value[1] === '/') return null;
  if (/[\\\s\u0000-\u001F\u007F]/.test(value)) return null;
  const queryAt = value.indexOf('?');
  const pathPart = queryAt === -1 ? value : value.slice(0, queryAt);
  if (/%2f|%5c|%2e/i.test(pathPart)) return null;
  const segments = pathPart.split('/').slice(1);
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  if (!SAFE_NEXT_ROOTS.includes(segments[0])) return null;
  return value;
}

export function pathAndQuery() {
  return `${window.location.pathname}${window.location.search}`;
}

let viewToken = {};
let cleanups = [];
let chromeKind = null;
let chromeApi = null;
let revoking = false;

export function currentView() {
  return viewToken;
}

export function isActive(token) {
  return token === viewToken;
}

export function onCleanup(fn) {
  const token = viewToken;
  cleanups.push({ token, fn });
}

function runCleanups() {
  const list = cleanups;
  cleanups = [];
  for (const entry of list) {
    try {
      entry.fn();
    } catch (error) {
      /* a page that is already gone */
    }
  }
}

export function navigate(url, { replace = false, render: shouldRender = true } = {}) {
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  if (shouldRender) render();
}

// Change the address without rebuilding the page.
export function setAddress(url, { replace = true } = {}) {
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
}

export function handleRevoked() {
  if (revoking) return;
  const here = pathAndQuery();
  if (here.startsWith('/login')) return;
  revoking = true;
  session.clear();
  runCleanups();
  navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
}

function resolve(pathname) {
  if (Object.prototype.hasOwnProperty.call(MARKETING_PAGES, pathname)) {
    return { chrome: 'marketing', bundle: 'marketing', name: MARKETING_PAGES[pathname], params: {} };
  }
  if (Object.prototype.hasOwnProperty.call(COCKPIT_PAGES, pathname)) {
    return { chrome: 'cockpit', bundle: 'cockpit', name: COCKPIT_PAGES[pathname], params: {} };
  }
  const account = /^\/app\/accounts\/([^/]+)$/.exec(pathname);
  if (account) {
    return { chrome: 'cockpit', bundle: 'cockpit', name: 'account', params: { accountId: account[1] } };
  }
  return { chrome: 'marketing', bundle: 'marketing', name: 'notFound', params: {} };
}

async function loadBundle(name) {
  if (name === 'marketing') return import('./pages/marketing.js');
  return import('./pages/cockpit.js');
}

function chromeRoot() {
  return document.getElementById('chrome');
}

export async function render() {
  runCleanups();
  // Each page's status region starts empty; a message written after a
  // navigation begins is kept.
  clearStatus();
  viewToken = {};
  const token = viewToken;
  const route = resolve(window.location.pathname);
  const query = new URLSearchParams(window.location.search);

  if (route.chrome === 'cockpit' && !session.signedIn()) {
    navigate(`/login?next=${encodeURIComponent(pathAndQuery())}`, { replace: true });
    return;
  }
  if ((route.name === 'login' || route.name === 'signup') && session.signedIn()) {
    const wanted = route.name === 'login' ? safeNext(query.get('next')) : null;
    navigate(wanted || '/app', { replace: true });
    return;
  }
  if (route.chrome !== 'cockpit') revoking = false;

  const bundle = await loadBundle(route.bundle);
  if (!isActive(token)) return;
  const page = bundle.pages[route.name];

  const context = {
    params: route.params,
    query,
    token,
    tint: null,
  };

  if (route.chrome === 'cockpit') {
    const shell = await bundle.ensureShell();
    if (!isActive(token)) return;
    chromeKind = 'cockpit';
    chromeApi = shell;
    context.shell = shell;
    const node = await page.render(context, shell);
    if (!isActive(token)) return;
    shell.mount(node, route.name, route.params);
  } else {
    if (chromeKind === 'cockpit' && chromeApi && chromeApi.teardown) chromeApi.teardown();
    chromeKind = 'marketing';
    chromeApi = null;
    const root = chromeRoot();
    clear(root);
    const node = await page.render(context);
    if (!isActive(token)) return;
    clear(root);
    root.append(node);
    window.scrollTo(0, 0);
  }
  document.documentElement.className = page.tint || '';
  if (page.title) document.title = page.title;
}

export function start() {
  api.setRevokedHandler(handleRevoked);
  window.addEventListener('popstate', () => {
    render();
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (!link) return;
    if (link.target === '_blank' || link.hasAttribute('download')) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    if (href.startsWith('/api/')) return;
    event.preventDefault();
    if (href === pathAndQuery()) return;
    navigate(href);
  });
  render();
}
