/** The shell: routing, panes, drawer, polling, banners and sign-in again. */

import { call, get, post } from './api.js';
import { announce, clear, el, takeFocus } from './dom.js';
import { closeAllDialogs, dialogHoldsTypedText, openDialog } from './dialog.js';
import signIn from './screen_signin.js';
import compartments, { compartment } from './screen_compartments.js';
import intake from './screen_intake.js';
import exhibit from './screen_exhibit.js';
import release, { reviews } from './screen_release.js';
import linkPage from './screen_link.js';
import walk from './screen_ledger.js';
import lattice from './screen_lattice.js';
import auditReview from './screen_audit.js';

const NOT_FOUND_COPY = 'Nothing to show at this address.';
const NO_RECORD_COPY = 'Choose a row to inspect it.';
const STORAGE_DOWN =
  'Exhibit storage is unreachable. Registration and downloads are paused; nothing has been lost.';
const MAIL_DOWN =
  'The mail relay is unreachable. Notices are held and will send when it returns.';
const SESSION_ENDED_UNSAVED =
  'Your session has ended. Sign in to finish what you were doing.';

export const state = {
  user: null,
  sessionId: null,
  breakGlass: [],
  compartments: [],
  storage: 'up',
  mail: 'up',
  screen: null,
};

const ROUTES = [
  { pattern: /^\/sign-in$/, screen: signIn, chrome: 'page', auth: false },
  { pattern: /^\/l\/[^/]+$/, screen: linkPage, chrome: 'page', auth: false },
  { pattern: /^\/compartments$/, screen: compartments, chrome: 'docket', pane: 'docket' },
  {
    pattern: /^\/compartments\/([^/]+)$/,
    screen: compartment,
    chrome: 'docket',
    pane: 'docket',
  },
  { pattern: /^\/exhibits\/([^/]+)$/, screen: exhibit, chrome: 'docket', pane: 'inspector' },
  { pattern: /^\/releases\/([^/]+)$/, screen: release, chrome: 'docket', pane: 'inspector' },
  { pattern: /^\/reviews$/, screen: reviews, chrome: 'docket', pane: 'docket', roles: ['case_lead'] },
  { pattern: /^\/intake$/, screen: intake, chrome: 'docket', pane: 'docket', roles: ['intake_officer'] },
  { pattern: /^\/ledger$/, screen: walk, chrome: 'page', roles: ['auditor'] },
  { pattern: /^\/ledger\/review$/, screen: auditReview, chrome: 'page', roles: ['auditor'] },
  { pattern: /^\/audit\/chain$/, screen: lattice, chrome: 'page', roles: ['auditor'] },
];

let root;
let topBar;
let banner;
let actionStatus;
let panes;
let paneNav;
let paneDocket;
let paneInspector;
let navList;
let drawer;
let drawerButton;
let pageHost;
let dialogHost;
let currentRoute = null;
let currentScreen = null;
let refreshTimer = null;
let sessionTimer = null;
let statusTimer = null;
let signInAgainOpen = false;
let lastFocused = null;

export function actionRegion() {
  return actionStatus;
}

export function go(path, replace) {
  if (replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  render();
}

function buildShell() {
  root = document.getElementById('root');
  clear(root);
  topBar = el('header', { class: 'topbar', hidden: true });
  banner = el('div', { id: 'banner' });
  actionStatus = el('p', {
    id: 'action-status',
    role: 'status',
    'aria-label': 'Action status',
    'aria-live': 'polite',
    hidden: true,
  });
  navList = el('nav', { 'aria-label': 'Compartments' });
  paneNav = el('div', { id: 'pane-nav' });
  paneDocket = el('section', { id: 'pane-docket', role: 'region', 'aria-label': 'Docket' });
  paneInspector = el('section', {
    id: 'pane-inspector',
    role: 'region',
    'aria-label': 'Inspector',
  });
  panes = el('main', { id: 'panes', hidden: true }, [paneNav, paneDocket, paneInspector]);
  pageHost = el('main', { id: 'page' });
  drawer = el('div', { id: 'drawer', hidden: true });
  dialogHost = el('div', { id: 'dialogs' });
  root.append(topBar, banner, actionStatus, drawer, panes, pageHost, dialogHost);
  window.addEventListener('popstate', () => render());
  window.addEventListener('resize', () => applyLayout());
  window.addEventListener('orientationchange', () => applyLayout());
  window.addEventListener('wardline:unauthenticated', onSessionEnded);
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest && event.target.closest('a[data-route]');
    if (!anchor) return;
    event.preventDefault();
    go(anchor.getAttribute('href'));
  });
  document.addEventListener('focusin', (event) => {
    if (!dialogHost.contains(event.target)) lastFocused = event.target;
  });
}

function renderTopBar() {
  clear(topBar);
  if (!state.user || (currentRoute && currentRoute.auth === false)) {
    topBar.hidden = true;
    return;
  }
  topBar.hidden = false;
  drawerButton = el('button', {
    type: 'button',
    text: 'Compartments',
    'aria-expanded': 'false',
    on: { click: () => openDrawer() },
  });
  topBar.append(
    window.innerWidth < 1200 ? drawerButton : el('span', { hidden: true }),
    el('span', { class: 'wordmark', text: 'WARDLINE' }),
    el('button', {
      type: 'button',
      text: 'Sign out',
      on: { click: signOut },
    })
  );
}

async function signOut() {
  await post('/api/sign-out', {});
  state.user = null;
  state.sessionId = null;
  closeAllDialogs();
  go('/sign-in');
}

function openDrawer() {
  drawer.hidden = false;
  drawer.inert = false;
  if (drawerButton) drawerButton.setAttribute('aria-expanded', 'true');
  clear(drawer);
  drawer.append(
    el('button', {
      type: 'button',
      text: 'Close compartments',
      on: { click: () => closeDrawer() },
    }),
    navList
  );
  drawer.addEventListener('keydown', drawerKeys);
  const first = navList.querySelector('a');
  takeFocus(first || drawer);
}

function drawerKeys(event) {
  if (event.key === 'Escape') closeDrawer();
}

function closeDrawer() {
  drawer.hidden = true;
  drawer.inert = true;
  if (drawerButton) {
    drawerButton.setAttribute('aria-expanded', 'false');
    takeFocus(drawerButton);
  }
  placeNav();
}

function placeNav() {
  const wide = window.innerWidth >= 1200;
  if (wide) {
    if (!paneNav.contains(navList)) paneNav.append(navList);
    drawer.hidden = true;
    drawer.inert = true;
  } else if (!drawer.hidden) {
    if (!drawer.contains(navList)) drawer.append(navList);
  } else if (!paneNav.contains(navList) && !drawer.contains(navList)) {
    paneNav.append(navList);
  }
}

export function renderNav() {
  clear(navList);
  for (const item of state.compartments) {
    navList.append(
      el('a', {
        href: `/compartments/${item.id}`,
        'data-route': 'true',
        text: item.id + ' ' + item.name,
      })
    );
  }
}

function applyLayout() {
  renderTopBar();
  const width = window.innerWidth;
  if (!currentRoute || currentRoute.chrome === 'page') {
    panes.hidden = true;
    panes.inert = true;
    pageHost.hidden = false;
    drawer.hidden = true;
    drawer.inert = true;
    return;
  }
  pageHost.hidden = true;
  panes.hidden = false;
  panes.inert = false;
  const showNav = width >= 1200;
  const showDocket = width >= 768 || currentRoute.pane === 'docket';
  const showInspector = width >= 768 || currentRoute.pane === 'inspector';
  setPane(paneNav, showNav);
  setPane(paneDocket, showDocket);
  setPane(paneInspector, showInspector);
  if (width >= 1200 && !drawer.hidden) closeDrawer();
  placeNav();
  if (
    document.activeElement &&
    document.activeElement !== document.body &&
    !isVisible(document.activeElement)
  ) {
    takeFocus(showInspector && !showDocket ? paneInspector : paneDocket);
  }
}

function isVisible(node) {
  return node.offsetParent !== null || node === document.body;
}

function setPane(pane, shown) {
  pane.hidden = !shown;
  pane.inert = !shown;
}

export function notFoundPage(host) {
  clear(host);
  host.append(
    el('div', { class: 'signin' }, [
      el('span', { dataset: { figure: 'true' }, text: '404' }),
      el('span', { dataset: { figureLabel: 'true' }, text: 'Not found' }),
      el('h1', { text: NOT_FOUND_COPY }),
    ])
  );
}

function matchRoute(path) {
  for (const route of ROUTES) {
    const found = route.pattern.exec(path);
    if (found) return { route, params: found.slice(1).map(decodeURIComponent) };
  }
  return null;
}

export async function loadSession() {
  const reply = await get('/api/session');
  if (reply.status !== 200) {
    state.user = null;
    return false;
  }
  state.user = reply.body.user;
  state.sessionId = reply.body.session_id;
  state.breakGlass = reply.body.break_glass || [];
  return true;
}

export async function loadCompartments() {
  const reply = await get('/api/compartments', { background: true });
  if (reply.status === 200) {
    state.compartments = reply.body.compartments;
    renderNav();
  }
}

async function pollStatus() {
  const reply = await get('/api/status', { background: true });
  if (reply.status !== 200) return;
  const changed = reply.body.storage !== state.storage || reply.body.mail !== state.mail;
  state.storage = reply.body.storage;
  state.mail = reply.body.mail;
  if (changed) renderBanner();
}

function renderBanner() {
  clear(banner);
  if (state.storage === 'down') {
    banner.append(
      el('div', { role: 'alert', 'aria-label': 'Service notice', text: STORAGE_DOWN })
    );
  } else if (state.mail === 'down') {
    banner.append(
      el('div', { role: 'alert', 'aria-label': 'Service notice', text: MAIL_DOWN })
    );
  }
}

async function pollSession() {
  const reply = await get('/api/session', { background: true });
  if (reply.status === 401) {
    onSessionEnded();
    return;
  }
  if (reply.status === 200) {
    state.breakGlass = reply.body.break_glass || [];
  }
}

function unsavedWork() {
  if (dialogHoldsTypedText()) return true;
  if (currentScreen && currentScreen.unsavedWork && currentScreen.unsavedWork()) return true;
  return false;
}

function onSessionEnded() {
  if (!state.user) return;
  if (currentRoute && currentRoute.auth === false) return;
  if (signInAgainOpen) return;
  if (!unsavedWork()) {
    state.user = null;
    stopTimers();
    go('/sign-in?next=' + encodeURIComponent(window.location.pathname));
    return;
  }
  openSignInAgain();
}

function openSignInAgain() {
  signInAgainOpen = true;
  const focusHolder = lastFocused;
  const status = el('p', {
    role: 'status',
    'aria-label': 'Sign-in again status',
    'aria-live': 'polite',
    text: SESSION_ENDED_UNSAVED,
  });
  const email = el('input', {
    type: 'text',
    readOnly: true,
    value: state.user ? state.user.email || '' : '',
    'aria-label': 'Email',
  });
  const password = el('input', { type: 'password', 'aria-label': 'Password' });
  const handle = openDialog({
    label: 'Sign in again',
    opener: null,
    onClose: () => {
      signInAgainOpen = false;
    },
    build: (node) => {
      node.append(
        el('label', { text: 'Email' }),
        email,
        el('label', { text: 'Password' }),
        password,
        el('div', {}, [
          el('button', { type: 'button', text: 'Sign in', on: { click: submit } }),
          el('button', {
            type: 'button',
            text: 'Leave page',
            on: { click: leave },
          }),
        ]),
        status
      );
    },
  });
  handle.root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') leave();
  });
  password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  setTimeout(() => password.focus(), 0);

  function leave() {
    handle.close(true);
    signInAgainOpen = false;
    state.user = null;
    go('/sign-in?next=' + encodeURIComponent(window.location.pathname));
  }

  async function submit() {
    announce(status, 'Signing in.');
    const reply = await post('/api/sign-in', {
      email: email.value,
      password: password.value,
    });
    if (reply.status === 429) {
      announce(status, 'Too many attempts. Try again later.');
      return;
    }
    if (reply.status !== 200) {
      announce(status, 'Email or password is not right.');
      return;
    }
    await loadSession();
    signInAgainOpen = false;
    handle.close(true);
    startTimers();
    takeFocus(focusHolder && document.body.contains(focusHolder) ? focusHolder : null);
    if (currentScreen && currentScreen.onResumed) currentScreen.onResumed();
  }
}

function stopTimers() {
  clearInterval(refreshTimer);
  clearInterval(sessionTimer);
  clearInterval(statusTimer);
  refreshTimer = sessionTimer = statusTimer = null;
}

function startTimers() {
  stopTimers();
  sessionTimer = setInterval(pollSession, 5000);
  statusTimer = setInterval(pollStatus, 5000);
  refreshTimer = setInterval(() => {
    loadCompartments();
    if (currentScreen && currentScreen.refresh) currentScreen.refresh();
  }, 3000);
}

export async function render() {
  const path = window.location.pathname;
  const found = matchRoute(path);
  if (currentScreen && currentScreen.dispose) currentScreen.dispose();
  currentScreen = null;
  closeAllDialogs();
  if (!found) {
    currentRoute = { chrome: 'page' };
    applyLayout();
    notFoundPage(pageHost);
    return;
  }
  const { route, params } = found;
  if (route.auth !== false) {
    if (!state.user && !(await loadSession())) {
      currentRoute = { chrome: 'page' };
      applyLayout();
      go('/sign-in?next=' + encodeURIComponent(path), true);
      return;
    }
  }
  if (route.roles && state.user && !route.roles.includes(state.user.role)) {
    currentRoute = { chrome: 'page' };
    applyLayout();
    notFoundPage(pageHost);
    return;
  }
  currentRoute = route;
  applyLayout();
  if (state.user) {
    renderBanner();
    await loadCompartments();
    startTimers();
    pollStatus();
  }
  const context = {
    params,
    docket: paneDocket,
    inspector: paneInspector,
    page: pageHost,
    status: actionStatus,
    state,
    go,
    width: () => window.innerWidth,
  };
  actionStatus.hidden = route.chrome !== 'docket';
  clear(paneDocket);
  clear(paneInspector);
  clear(pageHost);
  currentScreen = (await route.screen.mount(context)) || {};
  state.screen = currentScreen;
  applyLayout();
}

async function boot() {
  buildShell();
  const path = window.location.pathname;
  if (path !== '/sign-in' && !path.startsWith('/l/')) {
    await loadSession();
  }
  if (path === '/' ) {
    if (state.user) {
      go(landingFor(state.user.role), true);
      return;
    }
    go('/sign-in', true);
    return;
  }
  await render();
}

export function landingFor(role) {
  if (role === 'intake_officer') return '/intake';
  if (role === 'auditor') return '/ledger';
  return '/compartments';
}

boot();
