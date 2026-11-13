import { api, guard } from './api';
import { clear, el, trapFocus } from './dom';
import { disconnect, onLive } from './livesocket';
import { Me, announce, state, syncMainAttributes } from './state';
import { renderSignIn } from './views_auth';
import { renderDashboard, renderGroup, renderSearch } from './views_home';
import {
  renderBlame,
  renderCiEditor,
  renderCommit,
  renderCommits,
  renderCompare,
  renderEditor,
  renderFiles,
  renderProjectHome,
} from './views_repo';
import {
  renderChanges,
  renderConflicts,
  renderNewRequest,
  renderRequest,
  renderRequests,
  renderTrain,
} from './views_mr';
import {
  renderEnvironment,
  renderEnvironments,
  renderJob,
  renderMetrics,
  renderPipeline,
  renderPipelines,
} from './views_ci';
import { renderBoard, renderEpic, renderIssue, renderIssues, renderMilestone } from './views_plan';
import { renderAudit, renderExport, renderImport, renderSettings, renderWiki, renderWikiHistory } from './views_misc';

export type ViewContext = {
  params: Record<string, string>;
  query: URLSearchParams;
  main: HTMLElement;
};

type Route = { pattern: string[]; names: (string | null)[]; render: (ctx: ViewContext) => Promise<void> | void };

const routes: Route[] = [];

function addRoute(pattern: string, render: (ctx: ViewContext) => Promise<void> | void): void {
  const parts = pattern.split('/').filter((part) => part !== '');
  routes.push({
    pattern: parts,
    names: parts.map((part) => (part.startsWith(':') ? part.slice(1) : null)),
    render,
  });
}

addRoute('/sign-in', (ctx) => renderSignIn(ctx, 'in'));
addRoute('/sign-up', (ctx) => renderSignIn(ctx, 'up'));
addRoute('/', renderDashboard);
addRoute('/search', renderSearch);
addRoute('/projects/:id', renderProjectHome);
addRoute('/projects/:id/-/files', renderFiles);
addRoute('/projects/:id/-/blame', renderBlame);
addRoute('/projects/:id/-/commits', renderCommits);
addRoute('/projects/:id/-/commit/:commit', renderCommit);
addRoute('/projects/:id/-/compare', renderCompare);
addRoute('/projects/:id/-/edit', renderEditor);
addRoute('/projects/:id/-/ci/editor', renderCiEditor);
addRoute('/projects/:id/-/merge_requests', renderRequests);
addRoute('/projects/:id/-/merge_requests/new', renderNewRequest);
addRoute('/projects/:id/-/merge_requests/:iid', renderRequest);
addRoute('/projects/:id/-/merge_requests/:iid/changes', renderChanges);
addRoute('/projects/:id/-/merge_requests/:iid/conflicts', renderConflicts);
addRoute('/projects/:id/-/train', renderTrain);
addRoute('/projects/:id/-/pipelines', renderPipelines);
addRoute('/projects/:id/-/pipelines/:pipeline', renderPipeline);
addRoute('/projects/:id/-/jobs/:job', renderJob);
addRoute('/projects/:id/-/environments', renderEnvironments);
addRoute('/projects/:id/-/environments/:env', renderEnvironment);
addRoute('/projects/:id/-/metrics', renderMetrics);
addRoute('/projects/:id/-/issues', renderIssues);
addRoute('/projects/:id/-/issues/:iid', renderIssue);
addRoute('/projects/:id/-/milestones/:milestone', renderMilestone);
addRoute('/projects/:id/-/boards/:board', renderBoard);
addRoute('/projects/:id/-/wiki/:slug', renderWiki);
addRoute('/projects/:id/-/wiki/:slug/history', renderWikiHistory);
addRoute('/projects/:id/-/settings', renderSettings);
addRoute('/projects/:id/-/audit', renderAudit);
addRoute('/projects/:id/-/export', renderExport);
addRoute('/projects/:id/-/import', renderImport);
addRoute('/groups/:path/-/epics/:iid', renderEpic);
addRoute('/groups/:path/-/boards/:board', renderBoard);
addRoute('/groups/:path', renderGroup);

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render();
}

function matchRoute(pathname: string): { route: Route; params: Record<string, string> } | null {
  const segments = pathname.split('/').filter((part) => part !== '');
  let best: { route: Route; params: Record<string, string>; literals: number } | null = null;
  for (const route of routes) {
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    let literals = 0;
    for (let index = 0; index < segments.length; index += 1) {
      const name = route.names[index];
      if (name !== null) {
        params[name] = decodeURIComponent(segments[index]);
        continue;
      }
      if (route.pattern[index] !== segments[index]) {
        ok = false;
        break;
      }
      literals += 1;
    }
    if (!ok) continue;
    if (best === null || literals > best.literals) best = { route, params, literals };
  }
  return best === null ? null : { route: best.route, params: best.params };
}

function shell(): HTMLElement {
  const existing = document.getElementById('app');
  if (existing !== null) return document.querySelector('main') as HTMLElement;
  const strip = el('section', { role: 'region', 'aria-label': 'Instance status', id: 'instance-status', class: 'strip' }, [
    el('p', { text: state.stripText, id: 'instance-strip-text' }),
  ]);
  const groupsDialog = el('div', { role: 'dialog', 'aria-label': 'Groups', id: 'groups-dialog', class: 'sheet', hidden: true });
  const header = el('header', { role: 'banner', class: 'header' }, [
    el('a', { href: '/', 'aria-label': 'Spurline home', class: 'wordmark' }, ['Spurline']),
    el('button', { type: 'button', 'aria-label': 'Switch group', id: 'switch-group', class: 'ghost' }, [
      'Switch group',
      el('span', { class: 'chevron', 'aria-hidden': 'true', text: '▾' }),
    ]),
    groupsDialog,
    el('input', { type: 'search', role: 'searchbox', 'aria-label': 'Search', id: 'global-search', placeholder: 'Search' }),
    el('button', { type: 'button', 'aria-label': 'Account', class: 'ghost' }, ['Account']),
    el('button', { type: 'button', 'aria-label': 'Menu', class: 'ghost phone-only' }, ['Menu']),
  ]);
  const main = el('main', { 'data-seq': '0', 'data-pending': '0', tabindex: '-1' });
  const footer = el('footer', { role: 'contentinfo', class: 'footer' }, [
    el('nav', { 'aria-label': 'Work' }, [
      el('h2', { text: 'Work' }),
      el('a', { href: '/', text: 'Projects' }),
      el('a', { href: '/search?scope=code&q=', text: 'Code search' }),
    ]),
    el('nav', { 'aria-label': 'Delivery' }, [
      el('h2', { text: 'Delivery' }),
      el('a', { href: '/', text: 'Pipelines' }),
      el('a', { href: '/', text: 'Environments' }),
    ]),
    el('nav', { 'aria-label': 'Planning' }, [
      el('h2', { text: 'Planning' }),
      el('a', { href: '/', text: 'Issues' }),
      el('a', { href: '/', text: 'Boards' }),
    ]),
    el('nav', { 'aria-label': 'Account' }, [
      el('h2', { text: 'Account' }),
      el('a', { href: '/sign-in', text: 'Sign in' }),
    ]),
    el('p', { class: 'legal', text: 'Coldbrook Signal Works · Spurline' }),
  ]);
  const announcements = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Announcements',
    id: 'announcements',
    class: 'announcements',
  });
  const notifications = el('div', {
    role: 'region',
    'aria-label': 'Notifications',
    id: 'notifications',
    class: 'notifications',
  });
  const app = el('div', { id: 'app' }, [strip, header, main, footer, announcements, notifications]);
  document.body.append(app);
  wireHeader(header, groupsDialog);
  wireLandmarks();
  return main;
}

function wireHeader(header: HTMLElement, dialog: HTMLElement): void {
  const opener = header.querySelector<HTMLButtonElement>('#switch-group');
  const search = header.querySelector<HTMLInputElement>('#global-search');
  if (opener !== null) {
    let release: (() => void) | null = null;
    opener.addEventListener('click', () => {
      void (async () => {
        const groups = await api.get<{ groups: { id: number; path: string }[] }>('/api/groups');
        clear(dialog);
        dialog.append(el('h2', { text: 'Groups' }));
        for (const group of groups.groups) {
          dialog.append(el('a', { href: `/groups/${group.path}`, text: group.path }));
        }
        dialog.hidden = false;
        opener.setAttribute('aria-expanded', 'true');
        const first = dialog.querySelector<HTMLElement>('a');
        if (first !== null) first.focus();
        release = trapFocus(dialog, opener, () => {
          dialog.hidden = true;
          opener.setAttribute('aria-expanded', 'false');
          if (release !== null) release();
        });
      })();
    });
  }
  if (search !== null) {
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const scope = new URLSearchParams(window.location.search).get('scope') ?? 'issues';
      navigate(`/search?scope=${scope}&q=${encodeURIComponent(search.value)}`);
    });
  }
}

function wireLandmarks(): void {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'F6') return;
    event.preventDefault();
    const regions = [
      document.querySelector<HTMLElement>('header'),
      document.querySelector<HTMLElement>('[aria-label="Files"]'),
      document.querySelector<HTMLElement>('main'),
      document.querySelector<HTMLElement>('[aria-label="Merge request panel"]'),
      document.querySelector<HTMLElement>('footer'),
    ].filter((region): region is HTMLElement => region !== null);
    if (regions.length === 0) return;
    const active = document.activeElement;
    const index = regions.findIndex((region) => region === active || region.contains(active));
    const step = event.shiftKey ? -1 : 1;
    const next = regions[(index + step + regions.length) % regions.length];
    next.tabIndex = -1;
    next.focus();
  });
}

function wireLinks(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    const link = target.closest('a');
    if (link === null) return;
    const href = link.getAttribute('href');
    if (href === null || href.startsWith('http') || href.startsWith('/api/')) return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => {
    void render();
  });
}

async function loadInstance(): Promise<void> {
  const instance = await guard(() =>
    api.get<{ storage_down: boolean; strip: string; toast_ms: number }>('/api/instance'),
  );
  if (instance === null) return;
  state.storageDown = instance.storage_down;
  state.stripText = instance.strip;
  state.toastMs = instance.toast_ms;
  const text = document.getElementById('instance-strip-text');
  if (text !== null) text.textContent = instance.strip;
  const strip = document.getElementById('instance-status');
  if (strip !== null) strip.classList.toggle('outage', instance.storage_down);
}

export async function render(): Promise<void> {
  const main = shell();
  const match = matchRoute(window.location.pathname);
  disconnect();
  clear(main);
  state.pending = 0;
  syncMainAttributes();
  main.append(el('p', { id: 'panel-error', role: 'alert', class: 'strip-error', hidden: true }));
  if (match === null) {
    main.append(el('h1', { text: 'Not found' }));
    return;
  }
  await loadInstance();
  await match.route.render({ params: match.params, query: new URLSearchParams(window.location.search), main });
}

async function boot(): Promise<void> {
  wireLinks();
  onLive(() => undefined);
  if (window.location.pathname !== '/sign-in' && window.location.pathname !== '/sign-up') {
    const me = await guard(() => api.get<{ user: Me }>('/api/me'));
    if (me !== null) state.me = me.user;
    const config = await guard(() => api.get<{ toast_ms: number }>('/api/config'));
    if (config !== null) state.toastMs = config.toast_ms;
  }
  await render();
}

void boot();

export { announce };
