// The workspace router: every route is a real address that reloads to the same state.

import { h, clear, announce, outageBand, showProblem, hideProblem, statusRegion, COPY } from './ui.js';
import { api, subscribe, prefersReducedMotion, ApiProblem } from './app.js';
import { renderHero } from './hero.js';
import { renderWallList } from './walls.js';
import { renderSurvey } from './survey.js';
import { renderWorkspace } from './workspace.js';
import { renderShelf } from './shelf.js';
import { renderHire } from './hire.js';
import { renderSheet } from './sheet.js';
import { renderRig } from './rig.js';
import { renderOffline } from './offline.js';

const root = document.getElementById('root');

export const state = {
  site: null,
  layout: null,
  cells: new Map(),
  picker: null,
  outages: new Set(),
  sync: { waiting: 0, needsFixing: 0, sending: false },
};

export function route(path) {
  window.history.pushState({}, '', path);
  render();
}

export function render() {
  const path = window.location.pathname;
  clear(root);
  const band = outageBand();
  const shell = h('div', { class: 'screen' }, band);
  root.append(band);
  root.append(shell);
  if (state.outages.size > 0) {
    showProblem(band, { detail: [...state.outages][0] });
  }
  try {
    if (path === '/' || path === '') {
      root.innerHTML = '';
      renderHero(root);
      return;
    }
    const wallsMatch = path === '/sites';
    const surveyMatch = /^\/sites\/([^/]+)\/survey$/.exec(path);
    const workspaceMatch = /^\/sites\/([^/]+)\/layouts\/([^/]+)$/.exec(path);
    const kitMatch = path === '/kit';
    const hireMatch = path === '/hire';
    const sheetMatch = /^\/sheets\/([^/]+)$/.exec(path);
    const rigMatch = /^\/rig\/([^/]+)$/.exec(path);
    const offlineMatch = path === '/offline';

    if (wallsMatch) return renderWallList(shell, band);
    if (surveyMatch) return renderSurvey(shell, band, decodeURIComponent(surveyMatch[1]));
    if (workspaceMatch) return renderWorkspace(shell, band, decodeURIComponent(workspaceMatch[1]), decodeURIComponent(workspaceMatch[2]));
    if (kitMatch) return renderShelf(shell, band);
    if (hireMatch) return renderHire(shell, band);
    if (sheetMatch) return renderSheet(shell, band, decodeURIComponent(sheetMatch[1]));
    if (rigMatch) return renderRig(shell, band, decodeURIComponent(rigMatch[1]));
    if (offlineMatch) return renderOffline(shell);
    renderOffline(shell);
  } catch (err) {
    if (err instanceof ApiProblem) {
      showProblem(band, err.problem);
    } else {
      showProblem(band, { detail: 'Something went wrong on our side.' });
    }
  }
}

window.addEventListener('popstate', () => render());

document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[data-link]') : null;
  if (link === null) return;
  event.preventDefault();
  route(link.getAttribute('href'));
});

export function navigation(current) {
  const links = [
    { href: '/sites', label: 'Walls' },
    { href: '/kit', label: 'Shelf' },
    { href: '/hire', label: 'Hire' },
  ];
  return h('nav', { class: 'landmark', 'aria-label': 'Workspace' },
    links.map((link) => h('a', {
      href: link.href,
      'data-link': '',
      'aria-current': link.href === current ? 'page' : null,
    }, link.label)));
}

// The waiting count falls only as the server acknowledges each reading.
export function syncRegion(siteId) {
  const status = statusRegion('Sync');
  const button = h('button', { onclick: () => drain(siteId, status) }, 'Sync now');
  const wrapper = h('div', { class: 'row' }, status, button);
  drawSync(status);
  return wrapper;
}

export function drawSync(status) {
  clear(status);
  const lines = [COPY.syncWaiting(state.sync.waiting)];
  if (state.sync.needsFixing > 0) lines.push(COPY.syncNeedsFixing(state.sync.needsFixing));
  if (state.sync.sending) lines.unshift(COPY.syncSending);
  status.append(lines.join(' '));
}

async function drain(siteId, status) {
  state.sync.sending = true;
  drawSync(status);
  const { waiting, needsFixing } = await import('./app.js').then((m) => m.syncQueue(siteId, () => drawSync(status)));
  state.sync = { waiting, needsFixing, sending: false };
  drawSync(status);
}

export function watchLive(handler) {
  return subscribe((event) => handler(event));
}

// After one online visit the shell loads with no network.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // offline-first is best effort; the app works without it
    });
  });
}

render();
