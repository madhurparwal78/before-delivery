// The signed-in frame: router, top bar, panes, drawer, banners, background checks and grant watching.

import {
  api, ConnectionLost, canonicalTime, emptyState, figure, h, hasUnsaved, icon, onUnauthenticated, reducedMotion, session, unsignedSheet,
} from './core.js';
import { closeAllDialogs, openSignInAgain } from './dialogs.js';

const SESSION_CHECK_MS = 5000;
const STATUS_CHECK_MS = 4000;
const NAV_CHECK_MS = 4000;
const FIRST_LOAD_RETRY_MS = 2000;
const STORAGE_DOWN = 'Exhibit storage is unreachable. Registration and downloads are paused; nothing has been lost.';
const MAIL_DOWN = 'The mail relay is unreachable. Notices are held and will send when it returns.';
const NOT_FOUND = 'Nothing to show at this address.';
const WIDE = matchMedia('(min-width: 1200px)');

export const root = () => document.getElementById('root');

// ---- banners -------------------------------------------------------------------------------------
export const noticeSlot = h('div', { class: 'notice-slot' });

async function checkServices() {
  try {
    const answer = await api('GET', '/api/status', { background: true, quietSession: true });
    if (!answer.ok) return;
    const lines = [];
    if (answer.data.storage === 'down') lines.push(STORAGE_DOWN);
    if (answer.data.mail === 'down') lines.push(MAIL_DOWN);
    const text = lines.join(' ');
    const existing = noticeSlot.firstElementChild;
    if (!text) existing?.remove();
    else if (!existing) noticeSlot.append(h('div', { role: 'alert', 'aria-label': 'Service notice', class: 'service-notice' }, text));
    else if (existing.textContent !== text) existing.textContent = text;
  } catch (error) {
    if (!(error instanceof ConnectionLost)) throw error;
  }
}

export function startServiceChecks() {
  checkServices();
  setInterval(checkServices, STATUS_CHECK_MS);
}

// ---- action status -------------------------------------------------------------------------------
const actionStrip = h('div', { role: 'status', 'aria-label': 'Action status', class: 'action-status' });

export function actionStatus(copy, kind = '') {
  actionStrip.className = `action-status ${kind}`.trim();
  if (kind === 'refusal') actionStrip.replaceChildren(icon('refuse'), document.createTextNode(copy));
  else if (kind === 'hold') actionStrip.replaceChildren(icon('hold'), document.createTextNode(copy));
  else if (kind === 'success') actionStrip.replaceChildren(icon('check'), document.createTextNode(copy));
  else actionStrip.textContent = copy;
}

// ---- router --------------------------------------------------------------------------------------
const routes = [];
let current = null;

export function addRoute(pattern, loader, options = {}) {
  routes.push({ pattern, loader, ...options });
}

export function matchRoute(path) {
  for (const route of routes) {
    const found = route.pattern.exec(path);
    if (found) return { route, params: found.slice(1) };
  }
  return null;
}

export function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  renderRoute();
}

window.addEventListener('popstate', () => renderRoute());

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest?.('a[href]');
  if (!anchor || anchor.origin !== location.origin || anchor.dataset.plain !== undefined) return;
  event.preventDefault();
  navigate(anchor.pathname);
});

class Screen {
  constructor(params) {
    this.params = params;
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.timers = [];
    this.cleanups = [];
    this.stopped = false;
  }

  // Runs fn now and then every `ms`; stops with the screen. Overlapping runs are skipped.
  every(ms, fn, { now = true } = {}) {
    let running = false;
    const tick = async () => {
      if (this.stopped || running) return;
      running = true;
      try {
        await fn();
      } catch (error) {
        if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
      } finally {
        running = false;
      }
    };
    if (now) tick();
    const timer = setInterval(tick, ms);
    this.timers.push(timer);
    return () => clearInterval(timer);
  }

  onCleanup(fn) {
    this.cleanups.push(fn);
  }

  stop() {
    this.stopped = true;
    this.controller.abort();
    for (const timer of this.timers) clearInterval(timer);
    for (const fn of this.cleanups) fn();
  }

  // The whole screen becomes the not-found page; the address stays.
  notFound() {
    this.stop();
    showNotFound();
  }
}

export function notFoundContent() {
  return h('div', { class: 'not-found' }, figure('Not found', '404'), unsignedSheet(), h('h1', {}, NOT_FOUND));
}

function showNotFound() {
  const main = pageMain();
  closeAllDialogs();
  if (drawer.opener) drawer.opener.hidden = true;
  main.className = 'page page-not-found';
  for (const anchor of document.querySelectorAll('.bar-link')) anchor.removeAttribute('aria-current');
  main.replaceChildren(notFoundContent());
}

// ---- frame ---------------------------------------------------------------------------------------
let frame = null;
let mainElement = null;
const LINKS = {
  intake_officer: [['Intake', '/intake'], ['Docket', '/compartments']],
  case_lead: [['Docket', '/compartments'], ['Reviews', '/reviews']],
  investigator: [['Docket', '/compartments']],
  auditor: [['Ledger', '/ledger'], ['Lattice', '/audit/chain'], ['Review', '/ledger/review'], ['Docket', '/compartments']],
};

function pageMain() {
  return mainElement ?? root();
}

function buildTopBar(opener) {
  const signOut = h('button', {
    type: 'button',
    class: 'bar-button',
    'aria-label': 'Sign out',
    onclick: async () => {
      session.ended = true;
      await api('POST', '/api/sign-out', { body: {}, quietSession: true });
      location.assign('/sign-in');
    },
  }, icon('signOut'), h('span', { class: 'bar-label' }, 'Sign out'));
  return h('header', { class: 'topbar' },
    opener,
    h('a', { href: homeOf(session.me.role), class: 'brand' }, h('span', { class: 'brand-word' }, 'Wardline')),
    h('nav', { class: 'bar-links', 'aria-label': 'Sections' }, LINKS[session.me.role].map(([label, href]) => h('a', { href, class: 'bar-link' }, label))),
    h('span', { class: 'bar-who' }, session.me.name),
    signOut);
}

export function homeOf(role) {
  return { intake_officer: '/intake', auditor: '/ledger' }[role] ?? '/compartments';
}

// ---- compartments drawer ----------------------------------------------------------------------------
const drawer = {
  nav: null,
  list: null,
  opener: null,
  closeButton: null,
  open: false,
  animation: null,
};

function applyDrawerState() {
  const wide = WIDE.matches;
  const { nav, opener, closeButton } = drawer;
  if (!nav) return;
  if (wide && drawer.open) drawer.open = false;
  drawer.animation?.cancel();
  drawer.animation = null;
  nav.hidden = !wide && !drawer.open;
  nav.inert = !wide && !drawer.open;
  nav.classList.toggle('drawer-open', !wide && drawer.open);
  nav.removeAttribute('aria-hidden');
  closeButton.hidden = wide;
  opener.hidden = wide;
  opener.setAttribute('aria-expanded', String(drawer.open));
}

function openDrawer() {
  const { nav, opener, closeButton } = drawer;
  drawer.open = true;
  drawer.animation?.cancel();
  drawer.animation = null;
  nav.hidden = false;
  nav.inert = false;
  nav.removeAttribute('aria-hidden');
  nav.classList.add('drawer-open');
  closeButton.hidden = false;
  opener.setAttribute('aria-expanded', 'true');
  (nav.querySelector('a') ?? closeButton).focus();
  drawer.focusFirstLink = !nav.querySelector('a');
  if (!reducedMotion.matches) {
    drawer.animation = nav.animate({ transform: ['translateX(-100%)', 'translateX(0)'] }, { duration: 250, easing: 'cubic-bezier(.16,1,.3,1)' });
    drawer.animation.finished.then(() => { drawer.animation = null; }, () => {});
  }
}

function closeDrawer() {
  const { nav, opener } = drawer;
  drawer.open = false;
  opener.setAttribute('aria-expanded', 'false');
  nav.inert = true;
  opener.focus();
  if (reducedMotion.matches) {
    applyDrawerState();
    return;
  }
  nav.setAttribute('aria-hidden', 'true');
  drawer.animation?.cancel();
  const closing = nav.animate({ transform: ['translateX(0)', 'translateX(-100%)'] }, { duration: 250, easing: 'cubic-bezier(.16,1,.3,1)' });
  drawer.animation = closing;
  closing.finished.then(() => {
    if (drawer.animation === closing && !drawer.open) applyDrawerState();
  }, () => {});
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && drawer.open) {
    event.preventDefault();
    closeDrawer();
  }
});

export async function refreshDrawer() {
  const answer = await api('GET', '/api/compartments', { background: true });
  if (!answer.ok || !drawer.list) return;
  renderDrawerLinks(answer.data.compartments);
}

function renderDrawerLinks(compartments) {
  const wanted = new Set(compartments.map((c) => c.id));
  for (const item of [...drawer.list.children]) if (!wanted.has(item.dataset.id)) item.remove();
  const have = new Set([...drawer.list.children].map((item) => item.dataset.id));
  let previous = null;
  for (const compartment of compartments) {
    let item = [...drawer.list.children].find((candidate) => candidate.dataset.id === compartment.id);
    if (!have.has(compartment.id)) {
      item = h('li', { dataset: { id: compartment.id } }, h('a', { href: `/compartments/${compartment.id}`, class: 'nav-link' }, compartment.name));
      if (previous) previous.after(item);
      else drawer.list.prepend(item);
    }
    previous = item;
  }
  if (drawer.focusFirstLink && drawer.open && document.activeElement === drawer.closeButton) drawer.list.querySelector('a')?.focus();
  drawer.focusFirstLink = false;
  markCurrentCompartment();
}

let currentCompartment = null;

// The docket shown beside an exhibit or release stays marked in the navigation.
function markCurrentCompartment() {
  if (!drawer.list) return;
  for (const anchor of drawer.list.querySelectorAll('a')) {
    if (anchor.pathname === location.pathname) anchor.setAttribute('aria-current', 'page');
    else if (anchor.pathname === `/compartments/${currentCompartment}`) anchor.setAttribute('aria-current', 'true');
    else anchor.removeAttribute('aria-current');
  }
}

function markCurrentSection() {
  for (const anchor of document.querySelectorAll('.bar-link')) {
    const docketRoute = /^\/(compartments|exhibits|releases)(\/|$)/.test(location.pathname);
    if (anchor.pathname === location.pathname || (docketRoute && anchor.pathname === '/compartments')) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  }
}

function dropCompartmentLink(compartmentId) {
  drawer.list?.querySelector(`[data-id="${compartmentId}"]`)?.remove();
}

function ensureFrame() {
  if (frame) return;
  const opener = h('button', {
    type: 'button',
    class: 'bar-button bar-compartments',
    'aria-label': 'Compartments',
    'aria-expanded': 'false',
    onclick: () => (drawer.open ? closeDrawer() : openDrawer()),
  }, icon('menu'));
  drawer.opener = opener;
  mainElement = h('main', { class: 'page', id: 'page', tabindex: '-1' });
  frame = h('div', { class: 'frame' }, buildTopBar(opener), actionStrip, noticeSlot, mainElement);
  root().replaceChildren(frame);
  WIDE.addEventListener('change', () => {
    const focused = document.activeElement;
    applyDrawerState();
    if (focused && focused !== document.body && !focused.checkVisibility()) refocusVisiblePane();
  });
  matchMedia('(min-width: 768px)').addEventListener('change', () => {
    const focused = document.activeElement;
    if (focused && focused !== document.body && !focused.checkVisibility()) refocusVisiblePane();
  });
  startBackgroundChecks();
}

function refocusVisiblePane() {
  const pane = [...document.querySelectorAll('[role="region"][data-pane]')].find((candidate) => candidate.checkVisibility());
  pane?.focus();
}

let backgroundStarted = false;
function startBackgroundChecks() {
  if (backgroundStarted) return;
  backgroundStarted = true;
  setInterval(checkSession, SESSION_CHECK_MS);
}

async function checkSession() {
  if (session.ended) return;
  try {
    const answer = await api('GET', '/api/session', { background: true });
    if (answer.ok) {
      session.breakGlass = answer.data.break_glass;
      updateBreakGlassStatus();
    }
  } catch (error) {
    if (!(error instanceof ConnectionLost)) throw error;
  }
}

onUnauthenticated(() => {
  if (session.ended) {
    return;
  }
  session.ended = true;
  if (hasUnsaved()) openSignInAgain();
  else location.assign(`/sign-in?next=${encodeURIComponent(location.pathname)}`);
});

// ---- panes -------------------------------------------------------------------------------------------
// Builds the three docket panes. `narrowPane` is the pane shown below 768 pixels.
export function docketPanes(screen, narrowPane = 'docket') {
  const main = pageMain();
  currentCompartment = null;
  if (!drawer.nav) {
    drawer.list = h('ul', { class: 'nav-list' });
    drawer.closeButton = h('button', { type: 'button', class: 'btn drawer-close', onclick: () => closeDrawer() }, 'Close compartments');
    drawer.nav = h('nav', { 'aria-label': 'Compartments', class: 'pane-nav', tabindex: '-1' }, drawer.closeButton, drawer.list);
  }
  const docket = h('section', { role: 'region', 'aria-label': 'Docket', class: 'pane pane-docket', 'data-pane': 'docket', tabindex: '-1' });
  const inspector = h('section', { role: 'region', 'aria-label': 'Inspector', class: 'pane pane-inspector', 'data-pane': 'inspector', tabindex: '-1' });
  const accessSlot = h('div', { class: 'access-slot' });
  const breakGlassSlot = h('div', { class: 'break-glass-slot' });
  const grid = h('div', { class: `panes narrow-${narrowPane}` }, drawer.nav, docket, inspector);
  main.className = 'page page-panes';
  main.replaceChildren(accessSlot, breakGlassSlot, grid);
  applyDrawerState();
  screen.every(NAV_CHECK_MS, refreshDrawer);
  screen.onCleanup(() => {
    drawer.open = false;
  });
  markCurrentCompartment();
  return { docket, inspector, accessSlot, breakGlassSlot, grid };
}

export function noRecordCopy(pane) {
  pane.replaceChildren(emptyState('Choose a row to inspect it.'));
}

// Watches this compartment. Ends the screen's content when the caller's grant ends.
// `onNarrowed` runs when a full grant becomes derivatives only; `onData` receives each fresh compartment body.
let watchedBreakGlass = null;

export function watchCompartment(screen, compartmentId, panes, { onData, onNarrowed } = {}) {
  let scope = null;
  let ended = false;
  watchedBreakGlass = { compartmentId, slot: panes.breakGlassSlot };
  currentCompartment = compartmentId;
  markCurrentCompartment();
  updateBreakGlassStatus();
  const stop = screen.every(3000, async () => {
    if (ended) return;
    const answer = await api('GET', `/api/compartments/${compartmentId}`, { background: true, signal: screen.signal });
    if (answer.status === 404) {
      if (scope !== null) endAccess();
      return;
    }
    if (!answer.ok) return;
    if (scope === 'full' && answer.data.caller_scope === 'derivatives') onNarrowed?.();
    scope = answer.data.caller_scope;
    onData?.(answer.data);
    await checkSession();
  });
  function endAccess() {
    ended = true;
    stop();
    closeAllDialogs();
    screen.stop();
    panes.docket.replaceChildren();
    panes.inspector.replaceChildren();
    panes.breakGlassSlot.replaceChildren();
    dropCompartmentLink(compartmentId);
    const alert = h('div', { role: 'alert', 'aria-label': 'Access ended', class: 'access-ended', tabindex: '-1' }, 'Your access to this compartment has ended.');
    panes.accessSlot.replaceChildren(alert);
    alert.focus();
  }
  screen.seedScope = (value) => {
    scope = value;
  };
  screen.onCleanup(() => {
    watchedBreakGlass = null;
  });
}

function updateBreakGlassStatus() {
  if (!watchedBreakGlass) return;
  const holding = session.breakGlass.find((entry) => entry.compartment_id === watchedBreakGlass.compartmentId);
  const slot = watchedBreakGlass.slot;
  if (!holding) {
    slot.replaceChildren();
    return;
  }
  const text = `Break-glass ends at ${canonicalTime(holding.ends_at)}.`;
  if (slot.textContent !== text) {
    slot.replaceChildren(h('div', { role: 'status', 'aria-label': 'Break-glass time', class: 'break-glass-time' }, text));
  }
}

export async function refreshSession() {
  await checkSession();
}

// ---- rendering a route ------------------------------------------------------------------------------
export async function renderRoute() {
  current?.stop();
  current = null;
  const path = location.pathname;
  const matched = matchRoute(path);
  if (!matched) {
    if (session.me) ensureFrame();
    showNotFound();
    return;
  }
  const { route, params } = matched;
  const screen = new Screen(params);
  current = screen;
  if (session.me) {
    ensureFrame();
    markCurrentSection();
    drawer.opener.hidden = true;
    const main = pageMain();
    main.className = 'page';
    main.replaceChildren();
  }
  const module = await route.loader();
  if (screen.stopped) return;
  try {
    await module.mount(screen, pageMain());
  } catch (error) {
    if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
    // The first read never came back: the screen stays as drawn and asks again, unless the person has moved on.
    if (!screen.stopped) screen.timers.push(setTimeout(renderRoute, FIRST_LOAD_RETRY_MS));
    return;
  }
  if (session.me && document.activeElement === document.body && !route.keepFocus) pageMain().focus({ preventScroll: true });
}
