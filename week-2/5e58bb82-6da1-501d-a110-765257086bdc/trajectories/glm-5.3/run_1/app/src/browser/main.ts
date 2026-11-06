/* Main entry: routing, auth gating, guarded live refreshes. */
import { Mission, Line } from './app.js';
import { apiFetch } from './api.js';
import { h, clear } from './dom.js';
import { store, initUserSession, refreshCommon, recordScreen, setUnitsForUser } from './state.js';
import { topbar, renderSignIn, renderFleetBoard, renderMissionsTable, renderNotFound, patchFleetInPlace, patchAlertsInPlace } from './screens-core.js';
import { renderNewMission } from './screens-planner.js';
import { renderLinePlan, hasUnsavedChanges, clearUnsaved } from './screens-plan.js';
import { ConsoleScreen } from './screens-console.js';
import { renderLaunchList, watchHeldUpload } from './screens-launch.js';
import { renderSurveys, renderSurvey } from './screens-client.js';
import { renderHistory, renderFlags } from './screens-history.js';

const appEl = (): HTMLElement => document.getElementById('app') as HTMLElement;
let consoleScreen: ConsoleScreen | null = null;
let currentScreen = '';
let renderedSignature = '';

export interface RouteInfo {
  screen: string;
  missionId?: string;
  vesselId?: string;
  query: URLSearchParams;
}

export function parseRoute(): RouteInfo {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(location.search);
  const parts = path.split('/').filter(Boolean);
  if (path === '/' || path === '/sign-in') return { screen: path === '/' ? 'home' : 'sign-in', query };
  if (parts[0] === 'fleet') return { screen: 'fleet', vesselId: parts[1], query };
  if (parts[0] === 'missions' && parts[1] === 'new') return { screen: 'new-mission', query };
  if (parts[0] === 'missions' && parts[1]) {
    if (parts[2] === 'plan') return { screen: 'plan', missionId: parts[1], query };
    if (parts[2] === 'history') return { screen: 'history', missionId: parts[1], query };
    return { screen: 'console', missionId: parts[1], query };
  }
  if (parts[0] === 'launch') return { screen: 'launch', query };
  if (parts[0] === 'surveys' && parts[1]) return { screen: 'survey', missionId: parts[1], query };
  if (parts[0] === 'surveys') return { screen: 'surveys', query };
  if (parts[0] === 'flags') return { screen: 'flags', query };
  if (parts[0] === 'missions') return { screen: 'missions', query };
  return { screen: 'not-found', query };
}

function roleHomePath(u: { role: string }): string {
  if (u.role === 'principal_surveyor') return '/fleet';
  if (u.role === 'launch_technician') return '/launch';
  return '/surveys';
}

function canOpen(u: { role: string }, route: RouteInfo): boolean {
  if (route.screen === 'sign-in' || route.screen === 'home' || route.screen === 'not-found') return true;
  if (u.role === 'principal_surveyor') {
    return ['fleet', 'missions', 'new-mission', 'plan', 'console', 'launch', 'history', 'flags'].includes(route.screen);
  }
  if (u.role === 'launch_technician') {
    return ['fleet', 'missions', 'plan', 'console', 'launch', 'history', 'flags'].includes(route.screen);
  }
  return ['surveys', 'survey'].includes(route.screen);
}

async function renderRoute(): Promise<void> {
  const route = parseRoute();
  currentScreen = route.screen;
  const user = store.user;
  const root = appEl();

  if (!user) {
    clear(root);
    if (route.screen === 'sign-in') {
      renderSignIn(root, { next: route.query.get('next') ?? undefined, idle: route.query.get('idle') === '1' });
      return;
    }
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.replace(`/sign-in?next=${next}`);
    return;
  }

  if (route.screen === 'sign-in' || route.screen === 'home') {
    window.location.replace(roleHomePath(user));
    return;
  }

  if (!canOpen(user, route)) {
    clear(root);
    renderNotFound(root);
    return;
  }

  clear(root);
  root.append(topbar());
  const content = h('main', { id: 'content', class: 'content' });
  root.append(content);
  // Fresh data for data-driven screens, fetched after the shell paints.
  if (['fleet', 'missions', 'launch', 'surveys', 'console', 'plan', 'history'].includes(route.screen)) {
    await refreshCommon();
  }
  renderedSignature = store.dataSignature;

  switch (route.screen) {
    case 'fleet': {
      recordScreen(location.pathname);
      await renderFleetBoard(content, {
        selectedVesselId: route.vesselId ?? null,
        onSelect: (id: string | null) => {
          window.history.pushState({}, '', id ? `/fleet/${id}` : '/fleet');
          recordScreen(id ? `/fleet/${id}` : '/fleet');
          void renderRoute();
        },
        onSaveInterval: async (vesselId, hours, version, noteEl) => {
          const ann = document.getElementById('fleet-announcements');
          if (ann) ann.textContent = 'Saving interval';
          try {
            await apiFetch('PATCH', `/api/vessels/${vesselId}`, { service_interval_h: hours, version });
            if (ann) ann.textContent = `Service interval saved for ${store.vessels.find(x => x.id === vesselId)?.name ?? 'the vessel'}`;
            noteEl.textContent = '';
          } catch (err) {
            const e = err as { body?: { error?: string; message?: string; current?: { name: string; service_interval_h: number } } };
            if (e.body?.error === 'stale_version') {
              if (ann) ann.textContent = `${e.body.current?.name ?? 'This vessel'} was changed by someone else. Review the latest values and save again.`;
              noteEl.textContent = `Current: ${e.body.current?.service_interval_h} h`;
            } else if (ann) {
              ann.textContent = e.body?.message ?? 'Could not save the interval';
            }
          }
        },
      });
      break;
    }
    case 'missions': {
      recordScreen(location.pathname);
      content.append(h('div', { class: 'page-head' },
        h('h1', {}, 'Missions'),
        user.role === 'principal_surveyor' ? h('a', { class: 'btn primary', href: '/missions/new' }, 'New mission') : null),
        renderMissionsTable(store.missions));
      break;
    }
    case 'new-mission': {
      recordScreen(location.pathname);
      renderNewMission(content);
      break;
    }
    case 'plan': {
      recordScreen(location.pathname);
      try {
        const [mission, lines] = await Promise.all([
          apiFetch<Mission>('GET', `/api/missions/${route.missionId}`),
          apiFetch<Line[]>('GET', `/api/missions/${route.missionId}/lines`),
        ]);
        renderLinePlan(content, mission, lines);
      } catch {
        renderNotFound(content);
      }
      break;
    }
    case 'console': {
      recordScreen(location.pathname);
      consoleScreen = new ConsoleScreen(content, route.missionId!);
      consoleScreen.setView(route.query.get('view'));
      const ok = await consoleScreen.render();
      if (!ok) renderNotFound(content);
      break;
    }
    case 'launch': {
      recordScreen(location.pathname);
      renderLaunchList(content, store.missions);
      break;
    }
    case 'surveys': {
      recordScreen(location.pathname);
      renderSurveys(content);
      break;
    }
    case 'survey': {
      recordScreen(location.pathname);
      const ok = await renderSurvey(content, route.missionId!, route.query.get('vessel'));
      if (!ok) renderNotFound(content);
      break;
    }
    case 'history': {
      recordScreen(location.pathname);
      const mission = store.missions.find(m => m.id === route.missionId);
      await renderHistory(content, route.missionId!, mission?.name ?? route.missionId!, route.query.get('kinds'));
      break;
    }
    case 'flags': {
      recordScreen(location.pathname);
      await renderFlags(content);
      break;
    }
    default:
      renderNotFound(content);
  }
}

// ---------- link handling and leave guards ----------

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function unsavedCount(): number {
  let n = 0;
  for (const k of Object.keys(sessionStorage)) {
    if (k.startsWith('swathdeck-unsaved-')) {
      try {
        n += Object.keys(JSON.parse(sessionStorage.getItem(k) ?? '{}')).length;
      } catch { /* ignore */ }
    }
  }
  return n;
}

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
  if (!target) return;
  const href = target.getAttribute('href') ?? '';
  if (!href.startsWith('/')) return;
  e.preventDefault();
  if (currentScreen === 'plan' && hasUnsavedChanges() && !href.startsWith(`/missions/${parseRoute().missionId}`)) {
    const { openModal } = (void 0, domRef());
    openModal({ label: 'Unsaved assignments' }, (root2, close) => {
      const leave = h('button', { class: 'btn primary' }, 'Leave without saving');
      leave.addEventListener('click', () => {
        const missionId = parseRoute().missionId!;
        clearUnsaved(missionId);
        close();
        navigate(href);
      });
      root2.append(
        h('h2', {}, 'Unsaved assignments'),
        h('p', {}, `You have ${unsavedCount()} unsaved assignment changes.`),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn subtle', onclick: close }, 'Stay'),
          leave));
      leave.focus();
    });
    return;
  }
  navigate(href);
});

function domRef(): typeof import('./dom.js') {
  return domModule;
}

import * as domModule from './dom.js';

export function navigate(path: string): void {
  if (path.startsWith('/api/')) {
    window.location.href = path;
    return;
  }
  history.pushState({}, '', path);
  void renderRoute();
}

window.addEventListener('popstate', () => {
  void renderRoute();
});

// ---------- guarded live refresh ----------

function focusInsideContent(): boolean {
  const active = document.activeElement;
  if (!active || !document.getElementById('content')?.contains(active)) return false;
  return true;
}

function anyDialogOpen(): boolean {
  return document.querySelector('.dialog-backdrop') !== null;
}

function unsavedIntervalTyped(): boolean {
  const input = document.getElementById('service-interval-input') as HTMLInputElement | null;
  if (!input) return false;
  const v = store.vessels.find(x => x.id === input.dataset.vesselId);
  return v ? input.value !== String(v.service_interval_h) : false;
}

setInterval(() => {
  const route = parseRoute();
  if (!store.user) return;
  if (anyDialogOpen() || unsavedIntervalTyped()) return;
  const unchanged = store.dataSignature === renderedSignature;
  if (['fleet', 'missions', 'launch', 'surveys'].includes(route.screen)) {
    if (focusInsideContent() || unchanged) {
      if (route.screen === 'fleet' || route.screen === 'console') {
        patchFleetInPlace();
        patchAlertsInPlace(store.alerts);
      }
      return; // never move focus; the next tick re-renders when focus is free
    }
    void renderRoute();
  } else if (route.screen === 'console' && consoleScreen) {
    if (focusInsideContent() && document.activeElement?.tagName !== 'CANVAS') return;
    void consoleScreen.render(); // the console preserves its lens and chart focus across renders
  }
}, 2500);

window.addEventListener('swathdeck:rerender', () => { void renderRoute(); });

// ---------- boot ----------

async function boot(): Promise<void> {
  await initUserSession();
  watchHeldUpload();
  await renderRoute();
  await refreshCommon();
  if (store.user && store.dataSignature !== renderedSignature
      && ['fleet', 'missions', 'launch', 'surveys', 'console'].includes(parseRoute().screen)) {
    void renderRoute();
  }
}

void boot();
void setUnitsForUser;

// A page restored from the back/forward cache would show the previous account's
// screen; reload so the current session decides what is painted.
window.addEventListener('pageshow', (e) => {
  if (e.persisted) window.location.reload();
});
