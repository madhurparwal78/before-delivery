// The published routes, and the screens behind them.

import { raw, refreshingPaused } from './api.js';
import { clear, el } from './dom.js';
import { deskShell } from './shell.js';
import * as home from './screens/home.js';
import * as signIn from './screens/signin.js';
import * as board from './screens/board.js';
import * as windowDesk from './screens/window.js';
import * as lots from './screens/lots.js';
import * as ledger from './screens/ledger.js';
import * as queue from './screens/queue.js';
import * as review from './screens/review.js';
import * as group from './screens/group.js';
import * as check from './screens/check.js';
import * as statement from './screens/statement.js';

const REFRESH_MS = 3000;

const ROUTES = [
  { key: 'home', pattern: /^\/$/, screen: home, public: true },
  { key: 'sign-in', pattern: /^\/sign-in$/, screen: signIn, public: true },
  { key: 'check', pattern: /^\/check$/, screen: check, public: true },
  { key: 'statement', pattern: /^\/check\/([^/]+)$/, screen: statement, public: true },
  { key: 'board', pattern: /^\/windows$/, screen: board, roles: ['analyst', 'lead'] },
  {
    key: 'window',
    pattern: /^\/windows\/([^/]+)$/,
    screen: windowDesk,
    roles: ['analyst', 'lead', 'verifier'],
  },
  {
    key: 'lots',
    pattern: /^\/windows\/([^/]+)\/lots$/,
    screen: lots,
    roles: ['analyst', 'lead', 'verifier'],
  },
  {
    key: 'ledger',
    pattern: /^\/windows\/([^/]+)\/ledger$/,
    screen: ledger,
    roles: ['analyst', 'lead'],
  },
  { key: 'queue', pattern: /^\/review$/, screen: queue, roles: ['verifier'] },
  { key: 'review', pattern: /^\/review\/([^/]+)$/, screen: review, roles: ['verifier'] },
  { key: 'group', pattern: /^\/group$/, screen: group, roles: ['lead'] },
];

let active = null;
let account = null;
let poller = null;

export function navigate(path, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  render();
}

export function replaceQuery(path) {
  window.history.replaceState({}, '', path);
}

export function pushQuery(path) {
  window.history.pushState({}, '', path);
}

export function currentAccount() {
  return account;
}

function queryOf(search) {
  return Object.fromEntries(new URLSearchParams(search).entries());
}

function notFound(container) {
  clear(container);
  container.append(
    el('div', { className: 'panel centred' }, [
      el('h1', { text: 'THAT PAGE DOES NOT EXIST.' }),
      el('p', {}, [linkTo('/', 'Back to the poster')]),
    ])
  );
}

export function linkTo(href, text) {
  const link = el('a', { href, text });
  link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    navigate(href);
  });
  return link;
}

async function loadAccount() {
  const answer = await raw('GET', '/api/me');
  account = answer.status === 200 ? answer.data.user : null;
  return account;
}

export async function render() {
  const root = document.getElementById('screen');
  const path = window.location.pathname;
  const query = queryOf(window.location.search);
  const route = ROUTES.find((candidate) => candidate.pattern.test(path));
  if (!route) {
    stop();
    notFound(root);
    return;
  }
  const params = path.match(route.pattern).slice(1).map(decodeURIComponent);
  if (!route.public) {
    const user = await loadAccount();
    if (!user) {
      stop();
      navigate('/sign-in', { replace: true });
      return;
    }
    if (route.roles && !route.roles.includes(user.role)) {
      stop();
      const shell = deskShell(user);
      clear(root);
      root.append(shell.root);
      notFound(shell.main);
      return;
    }
  }
  const key = `${route.key}:${params.join('/')}`;
  if (active && active.key === key && active.api.query) {
    active.api.query(query);
    return;
  }
  stop();
  clear(root);
  let container = root;
  if (!route.public) {
    const shell = deskShell(account);
    root.append(shell.root);
    container = shell.main;
  }
  const api = (await route.screen.mount({ container, params, query, account })) || {};
  active = { key, api, route };
  if (api.refresh) {
    poller = window.setInterval(() => {
      if (!refreshingPaused()) api.refresh();
    }, REFRESH_MS);
  }
}

function stop() {
  if (poller !== null) window.clearInterval(poller);
  poller = null;
  if (active && active.api.teardown) active.api.teardown();
  active = null;
}

window.addEventListener('popstate', () => {
  render();
});
