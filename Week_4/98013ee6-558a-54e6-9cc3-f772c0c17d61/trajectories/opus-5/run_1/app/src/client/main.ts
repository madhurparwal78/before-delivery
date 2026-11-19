import type { PublicConfig } from '../shared/types.js';
import {
  announce,
  api,
  clear,
  clearAlert,
  closeUndoToast,
  el,
  navigate,
  registerRegions,
  renderTimes,
  setBusinessNow,
  state,
} from './core.js';
import { connectLive, onLive } from './live.js';
import { consumeSuppressed, currentExhibit, exhibitReturnPath } from './exhibit.js';
import { layoutAllGrids } from './grid.js';
import type { RouteContext, View } from './view.js';
import { inviteView, landingView, notFoundView, signInView, signUpView } from './views/auth.js';
import { boardsView, feedView, pinPageView, profileView, searchView } from './views/feed.js';
import { boardView } from './views/board.js';
import { composerView } from './views/composer.js';

const NAV_LINKS: { href: string; label: string; icon: string }[] = [
  { href: '/', label: 'Home', icon: '◉' },
  { href: '/search', label: 'Search', icon: '⌕' },
  { href: '/create', label: 'Create', icon: '＋' },
  { href: '/boards', label: 'Boards', icon: '▤' },
  { href: '/u/me', label: 'Profile', icon: '☾' },
];

let currentView: View | null = null;
let main: HTMLElement;
let topbar: HTMLElement;
let tabs: HTMLElement;

function buildShell(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing app root');
  clear(root);
  topbar = el('header', { class: 'topbar' });
  main = el('main', { id: 'main' });
  tabs = el('nav', { class: 'tabbar', 'aria-label': 'Tabs' });
  const polite = el('div', {
    class: 'sr-only',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Announcements',
  });
  const notices = el('div', { class: 'notices', role: 'status', 'aria-label': 'Notices' });
  const alertRegion = el('div', { class: 'alert-region', role: 'alert' });
  root.append(topbar, main, tabs, polite, notices, alertRegion);
  registerRegions(polite, notices, alertRegion);
}

function paintShell(): void {
  clear(topbar);
  clear(tabs);
  if (!state.user) return;
  const wordmark = el('a', { class: 'wordmark', href: '/', text: 'MOTHLIGHT' });
  const primary = el('nav', { class: 'primary', 'aria-label': 'Primary' });
  const handle = state.user.handle;
  for (const link of NAV_LINKS) {
    const href = link.href === '/u/me' ? `/u/${handle}` : link.href;
    primary.append(el('a', { href, text: link.label }));
    const tab = el('a', { href, class: 'tab' });
    tab.append(
      el('span', { class: 'tab-icon', 'aria-hidden': 'true', text: link.icon }),
      el('span', { class: 'tab-label', text: link.label }),
    );
    tabs.append(tab);
  }
  const search = el('input', {
    type: 'search',
    class: 'topbar-search',
    'aria-label': 'Search pins',
    placeholder: 'Search pins',
  });
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    navigate(`/search?q=${encodeURIComponent(search.value.trim())}`);
  });
  const menu = el('div', { class: 'profile-menu' });
  const signOut = el('button', { type: 'button', class: 'secondary', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void (async () => {
      await api.del('/api/session');
      state.user = null;
      paintShell();
      navigate('/');
    })();
  });
  menu.append(signOut);
  topbar.append(wordmark, primary, search, menu);
}

interface Route {
  pattern: string[];
  signedIn: boolean;
  build(context: RouteContext): View;
}

const routes: Route[] = [
  { pattern: ['signin'], signedIn: false, build: (context) => signInView(context) },
  { pattern: ['signup'], signedIn: false, build: (context) => signUpView(context) },
  { pattern: ['invites', ':token'], signedIn: false, build: (context) => inviteView(context) },
  { pattern: ['pin', ':id'], signedIn: true, build: (context) => pinPageView(context) },
  { pattern: ['create'], signedIn: true, build: (context) => composerView(context) },
  { pattern: ['boards'], signedIn: true, build: (context) => boardsView(context) },
  { pattern: ['b', ':id'], signedIn: true, build: (context) => boardView(context) },
  { pattern: ['u', ':handle'], signedIn: true, build: (context) => profileView(context) },
  { pattern: ['search'], signedIn: true, build: (context) => searchView(context) },
];

function match(candidate: Route, segments: string[]): Record<string, string> | null {
  if (candidate.pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of candidate.pattern.entries()) {
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[index]);
    else if (part !== segments[index]) return null;
  }
  return params;
}

function route(): void {
  const url = new URL(location.href);
  const exhibit = currentExhibit();
  if (exhibit) {
    if (url.pathname === `/pin/${exhibit.pinId}`) return;
    exhibit.close();
    if (`${url.pathname}${url.search}` === exhibitReturnPath()) return;
  }
  if (consumeSuppressed(`${url.pathname}${url.search}`)) return;

  currentView?.dispose?.();
  currentView = null;
  clearAlert();
  paintShell();
  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  const context: RouteContext = { main, url, params: {} };

  if (segments.length === 0) {
    currentView = state.user ? feedView(context) : landingView(context);
    return;
  }
  for (const candidate of routes) {
    const params = match(candidate, segments);
    if (!params) continue;
    if (candidate.signedIn && !state.user) {
      navigate(`/signin?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`, {
        replace: true,
      });
      return;
    }
    currentView = candidate.build({ ...context, params });
    return;
  }
  currentView = notFoundView(context, 'Page not found');
}

function interceptLinks(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest('a');
    if (!(link instanceof HTMLAnchorElement)) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || link.target === '_blank') return;
    event.preventDefault();
    navigate(href);
  });
}

function trackMotion(): void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const apply = (): void => {
    document.documentElement.dataset.motion = query.matches ? 'reduced' : 'full';
  };
  apply();
  query.addEventListener('change', apply);
}

async function boot(): Promise<void> {
  buildShell();
  trackMotion();
  interceptLinks();
  const config = await api.get<PublicConfig>('/api/config');
  state.config = config;
  setBusinessNow(config.now);
  try {
    const me = await api.get<{ user: { id: number; name: string; handle: string; email: string } }>(
      '/api/me',
    );
    state.user = me.user;
  } catch {
    state.user = null;
  }
  paintShell();
  if (state.user) connectLive();
  onLive((message) => {
    if (message.type === 'operation_expired') {
      closeUndoToast(message.id);
      return;
    }
    if (message.type === 'clock') {
      renderTimes();
    }
  });
  window.addEventListener('popstate', () => route());
  window.addEventListener('resize', () => layoutAllGrids());
  route();
  announce('');
}

void boot();
