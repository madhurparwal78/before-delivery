import { tabSlide } from './animate.js';
import { clear, el } from './dom.js';
import { displayTime, ZONES } from './format.js';
import {
  addShellListener,
  connectLive,
  get,
  setLiveHandler,
  setShellHooks,
  state,
  write,
  type Config,
  type Me,
} from './state.js';
import { layoutBand, openDialog } from './widgets.js';
import { renderSignIn, renderSignUp } from './pages/auth.js';
import { renderExplore } from './pages/explore.js';
import { renderPipes } from './pages/pipes.js';
import { renderAnalyze, renderLifecycle, renderStream, renderStreams } from './pages/streams.js';
import { renderPipeline, renderPipelines, renderSimulate } from './pages/pipelines.js';
import { renderAlerts, renderMaintenance, renderNewRule, renderRule } from './pages/alerts.js';
import { renderInbox } from './pages/inbox.js';
import { renderCase, renderCases } from './pages/cases.js';
import { renderTrace, renderTraces } from './pages/traces.js';
import { renderObjectives } from './pages/objectives.js';
import { renderSpaces } from './pages/spaces.js';
import { renderKeys } from './pages/keys.js';
import { renderRules } from './pages/rules.js';

type PageRenderer = (main: HTMLElement, params: Record<string, string>) => Promise<void> | void;

type Route = { pattern: string; render: PageRenderer; tab?: string; open: boolean };

const ROUTES: Route[] = [
  { pattern: '/signin', render: renderSignIn, open: true },
  { pattern: '/signup', render: renderSignUp, open: true },
  { pattern: '/explore', render: renderExplore, tab: 'Explore', open: false },
  { pattern: '/pipes', render: renderPipes, tab: 'Pipes', open: false },
  { pattern: '/streams', render: renderStreams, tab: 'Streams', open: false },
  { pattern: '/streams/:stream', render: renderStream, tab: 'Streams', open: false },
  { pattern: '/streams/:stream/analyze', render: renderAnalyze, tab: 'Streams', open: false },
  { pattern: '/streams/:stream/lifecycle', render: renderLifecycle, tab: 'Streams', open: false },
  { pattern: '/pipelines', render: renderPipelines, tab: 'Pipelines', open: false },
  { pattern: '/pipelines/:name', render: renderPipeline, tab: 'Pipelines', open: false },
  { pattern: '/pipelines/:name/simulate', render: renderSimulate, tab: 'Pipelines', open: false },
  { pattern: '/alerts', render: renderAlerts, tab: 'Alerts', open: false },
  { pattern: '/alerts/new', render: renderNewRule, tab: 'Alerts', open: false },
  { pattern: '/alerts/maintenance', render: renderMaintenance, tab: 'Alerts', open: false },
  { pattern: '/alerts/:id', render: renderRule, tab: 'Alerts', open: false },
  { pattern: '/inbox', render: renderInbox, tab: 'Inbox', open: false },
  { pattern: '/cases', render: renderCases, tab: 'Cases', open: false },
  { pattern: '/cases/:number', render: renderCase, tab: 'Cases', open: false },
  { pattern: '/traces', render: renderTraces, tab: 'Traces', open: false },
  { pattern: '/traces/:id', render: renderTrace, tab: 'Traces', open: false },
  { pattern: '/objectives', render: renderObjectives, tab: 'Objectives', open: false },
  { pattern: '/spaces', render: renderSpaces, tab: 'Spaces', open: false },
  { pattern: '/keys', render: renderKeys, tab: 'Keys', open: false },
  { pattern: '/rules', render: renderRules, open: false },
];

const TABS = [
  'Explore',
  'Pipes',
  'Streams',
  'Pipelines',
  'Alerts',
  'Inbox',
  'Cases',
  'Traces',
  'Objectives',
  'Spaces',
  'Keys',
];

let ingestLine: HTMLElement;
let serverTimeLine: HTMLElement;
let announcements: HTMLElement;
let main: HTMLElement;
let navigation: HTMLElement;
let underline: HTMLElement;
let currentTab: string | null = null;
let renderedBand = layoutBand();

function matchRoute(path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of ROUTES) {
    const patternParts = route.pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < patternParts.length; index += 1) {
      const expected = patternParts[index];
      if (expected.startsWith(':')) {
        params[expected.slice(1)] = decodeURIComponent(pathParts[index]);
        continue;
      }
      if (expected !== pathParts[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  void render();
}

function updateShellLines(): void {
  main.setAttribute('data-seq', String(state.seq));
  serverTimeLine.textContent = `Server time ${displayTime(state.me?.time_zone ?? 'UTC', state.serverTimeMs)}`;
  ingestLine.textContent = `${state.stored} events stored, ${state.failures} in failure store`;
}

function buildShell(): void {
  const root = document.getElementById('app') as HTMLElement;
  clear(root);
  ingestLine = el('div', { role: 'region', 'aria-label': 'Ingest status', class: 'ingest-bar' }, [
    '0 events stored, 0 in failure store',
  ]);
  serverTimeLine = el('span', { class: 'mono server-time', text: 'Server time' });
  const spaceButton = el('button', { type: 'button', 'aria-label': 'Space', text: 'Space' });
  const accountButton = el('button', { type: 'button', 'aria-label': 'Account', text: 'Account' });
  spaceButton.addEventListener('click', () => openSpaceMenu(spaceButton));
  accountButton.addEventListener('click', () => openAccountDialog(accountButton));
  const banner = el('header', { role: 'banner', class: 'banner' }, [
    el('span', { class: 'product', text: 'Spoorline' }),
    serverTimeLine,
    el('span', { class: 'banner-actions' }, [spaceButton, accountButton]),
  ]);
  underline = el('span', { class: 'tab-underline' });
  navigation = el('nav', { 'aria-label': 'Workspace', class: 'tabs' }, [
    ...TABS.map((tab) => el('a', { href: `/${tab.toLowerCase()}`, text: tab, class: 'tab' })),
    underline,
  ]);
  announcements = el('div', {
    role: 'status',
    'aria-label': 'Announcements',
    'aria-live': 'polite',
    class: 'announcements',
  });
  main = el('main', { 'data-seq': '0', 'data-pending': '0' });
  const footer = el('footer', { role: 'contentinfo', class: 'footer' }, [
    el('span', { text: 'Spoorline' }),
    el('a', { href: '/rules', text: 'Published rules', 'aria-label': 'Published rules' }),
  ]);
  root.append(ingestLine, banner, navigation, announcements, main, footer);

  setShellHooks({
    announce: (sentences) => {
      announcements.textContent = sentences.join(' ');
    },
    pending: () => {
      main.setAttribute('data-pending', String(state.pending));
    },
  });
  addShellListener(() => updateShellLines());

  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || !href.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => {
    void render();
  });
  // A layout band change swaps tables for cards and sheets for dialogs, so the view is drawn again.
  window.addEventListener('resize', () => {
    const band = layoutBand();
    if (band === renderedBand) return;
    renderedBand = band;
    void render();
  });
}

function openSpaceMenu(opener: HTMLButtonElement): void {
  opener.parentElement?.querySelector('[role="menu"]')?.remove();
  const menu = el('div', { role: 'menu', 'aria-label': 'Spaces', class: 'menu' });
  for (const space of state.me?.spaces ?? []) {
    const item = el('button', {
      type: 'button',
      role: 'menuitemradio',
      'aria-label': space.name,
      'aria-checked': String(space.slug === state.me?.space.slug),
      text: space.name,
    });
    item.addEventListener('click', () => {
      menu.remove();
      void switchSpace(space.slug);
    });
    menu.append(item);
  }
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      menu.remove();
      opener.focus();
    }
  });
  opener.after(menu);
  menu.querySelector<HTMLElement>('button')?.focus();
}

async function switchSpace(slug: string): Promise<void> {
  state.me = await write<Me>('PATCH', '/api/me', { space: slug });
  connectLive(slug);
  await refreshIngest();
  void render();
}

function openAccountDialog(opener: HTMLButtonElement): void {
  openDialog({
    label: 'Account',
    opener,
    content: (dialog) => {
      const zoneSelect = el(
        'select',
        { 'aria-label': 'Time zone', 'data-field': 'time_zone' },
        ZONES.map((zone) =>
          el('option', { value: zone, text: zone, selected: zone === state.me?.time_zone }),
        ),
      );
      const save = el('button', { type: 'button', 'aria-label': 'Save account', text: 'Save account' });
      save.addEventListener('click', () => {
        void (async () => {
          state.me = await write<Me>('PATCH', '/api/me', { time_zone: zoneSelect.value });
          dialog.close();
          announcements.textContent = `Time zone set to ${zoneSelect.value}.`;
          updateShellLines();
          void render();
        })();
      });
      const signOut = el('button', { type: 'button', 'aria-label': 'Sign out', text: 'Sign out' });
      signOut.addEventListener('click', () => {
        void (async () => {
          await write('POST', '/api/signout');
          state.me = null;
          dialog.close();
          navigate('/signin');
        })();
      });
      return [el('h2', { text: 'Account' }), zoneSelect, save, signOut];
    },
  });
}

export async function refreshIngest(): Promise<void> {
  try {
    const streams = await get<{ streams: { events: number; failures: number }[] }>('/api/streams');
    state.stored = streams.streams.reduce((sum, stream) => sum + stream.events, 0);
    state.failures = streams.streams.reduce((sum, stream) => sum + stream.failures, 0);
  } finally {
    updateShellLines();
  }
}

function markTab(tab: string | null): void {
  const links = [...navigation.querySelectorAll<HTMLAnchorElement>('a.tab')];
  let activeLeft = 0;
  let activeWidth = 0;
  let previousLeft = 0;
  for (const link of links) {
    if (link.textContent === currentTab) previousLeft = link.offsetLeft;
    if (link.textContent === tab) {
      link.setAttribute('aria-current', 'page');
      activeLeft = link.offsetLeft;
      activeWidth = link.offsetWidth;
    } else {
      link.removeAttribute('aria-current');
    }
  }
  if (activeWidth > 0) {
    underline.style.width = `${activeWidth}px`;
    underline.style.transform = `translateX(${activeLeft}px)`;
    underline.hidden = false;
    if (currentTab !== null && currentTab !== tab) {
      tabSlide(underline, previousLeft, activeLeft, activeWidth);
    }
  } else {
    underline.hidden = true;
  }
  currentTab = tab;
}

function notFound(): void {
  clear(main);
  main.append(
    el('h1', { class: 'view-title', text: 'Page not found.' }),
    el('a', { href: '/explore', text: 'Go to Explore', 'aria-label': 'Go to Explore' }),
  );
}

async function render(): Promise<void> {
  const path = window.location.pathname === '/' ? '/explore' : window.location.pathname;
  const matched = matchRoute(path);
  setLiveHandler(null);
  if (!matched) {
    if (!state.me) {
      navigate('/signin', true);
      return;
    }
    markTab(null);
    notFound();
    return;
  }
  if (!matched.route.open && !state.me) {
    navigate('/signin', true);
    return;
  }
  if (matched.route.open && state.me) {
    navigate('/explore', true);
    return;
  }
  document.body.dataset.signedIn = state.me ? 'true' : 'false';
  markTab(matched.route.tab ?? null);
  clear(main);
  updateShellLines();
  main.setAttribute('data-pending', String(state.pending));
  await matched.route.render(main, matched.params);
}

export async function signedIn(me: Me): Promise<void> {
  state.me = me;
  state.seq = me.seq;
  connectLive(me.space.slug);
  await refreshIngest();
}

async function boot(): Promise<void> {
  buildShell();
  state.config = await get<Config>('/api/config');
  try {
    const time = await get<{ now_ms: number }>('/api/time');
    state.serverTimeMs = time.now_ms;
  } catch {
    state.serverTimeMs = Date.now();
  }
  try {
    const me = await get<Me>('/api/me');
    await signedIn(me);
  } catch {
    state.me = null;
  }
  await render();
}

void boot();
