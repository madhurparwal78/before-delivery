import type { SessionUser } from '../shared/api';
import { api, RequestFailed } from './api';
import { clear, el } from './dom';
import { renderCorrections } from './screens/corrections';
import { renderEventOverview } from './screens/overview';
import { renderEvents } from './screens/events';
import { renderIndexTables } from './screens/indexTables';
import { renderJoin } from './screens/join';
import { renderLive } from './screens/live';
import { renderOperator } from './screens/operator';
import { renderProtests } from './screens/protests';
import { renderPublish } from './screens/publish';
import { renderRota } from './screens/rota';
import { renderSeason } from './screens/season';
import { renderSignIn } from './screens/signin';
import { renderTiming } from './screens/timing';

export interface ScreenHandle {
  element: HTMLElement;
  destroy?: () => void;
}

export interface ScreenContext {
  user: SessionUser | null;
  params: Record<string, string>;
  navigate: (path: string, options?: { replace?: boolean }) => void;
  refreshSession: () => Promise<void>;
}

type Screen = (ctx: ScreenContext) => ScreenHandle;

interface RouteDef {
  pattern: RegExp;
  keys: string[];
  screen: Screen;
  anonymous: boolean;
}

function route(path: string, screen: Screen, anonymous = false): RouteDef {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:[a-zA-Z]+/g, (match) => {
      keys.push(match.slice(1));
      return '([^/]+)';
    })}$`,
  );
  return { pattern, keys, screen, anonymous };
}

const routes: RouteDef[] = [
  route('/signin', renderSignIn, true),
  route('/join/:clubSlug', renderJoin, true),
  route('/events', renderEvents),
  route('/events/:id', renderEventOverview),
  route('/events/:id/timing', renderTiming),
  route('/events/:id/rota', renderRota),
  route('/events/:id/live', renderLive),
  route('/events/:id/protests', renderProtests),
  route('/events/:id/corrections', renderCorrections),
  route('/events/:id/publish', renderPublish),
  route('/index-tables', renderIndexTables),
  route('/season', renderSeason),
  route('/operator', renderOperator),
];

let currentUser: SessionUser | null = null;
let activeScreen: ScreenHandle | null = null;

const root = document.getElementById('app');
if (!root) throw new Error('App root is missing');

const header = el('header', { class: 'app-header' });
const main = el('main', { class: 'app-main', attrs: { id: 'main' } });
root.appendChild(header);
root.appendChild(main);

function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render();
}

async function refreshSession(): Promise<void> {
  try {
    const result = await api.session.current();
    currentUser = result.user;
  } catch (error) {
    if (error instanceof RequestFailed && error.status === 401) {
      currentUser = null;
      return;
    }
    throw error;
  }
}

function renderHeader(): void {
  clear(header);
  if (!currentUser) return;
  const links: HTMLElement[] = [];
  if (currentUser.club) {
    links.push(appLink('Events', '/events'));
    links.push(appLink('Index tables', '/index-tables'));
    links.push(appLink('Season', '/season'));
  }
  if (currentUser.roles.includes('operator')) {
    links.push(appLink('Club workspaces', '/operator'));
  }
  header.appendChild(
    el(
      'div',
      { class: 'app-header__bar' },
      el(
        'div',
        { class: 'app-header__identity' },
        el('span', { class: 'app-header__club', text: currentUser.club?.name ?? 'Pylonworks operator' }),
        el('span', { class: 'app-header__user', text: currentUser.name }),
      ),
      el('nav', { class: 'app-header__nav', attrs: { 'aria-label': 'Workspace' } }, links),
      el('button', {
        class: 'button button--secondary',
        text: 'Sign out',
        attrs: { type: 'button' },
        on: {
          click: () => {
            void (async () => {
              await api.session.signOut();
              currentUser = null;
              navigate('/signin');
            })();
          },
        },
      }),
    ),
  );
}

export function appLink(label: string, href: string, className = 'app-link'): HTMLAnchorElement {
  return el('a', {
    class: className,
    text: label,
    attrs: { href },
    on: {
      click: (event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href);
      },
    },
  });
}

async function render(): Promise<void> {
  const path = window.location.pathname;
  const match = routes
    .map((candidate) => ({ candidate, result: candidate.pattern.exec(path) }))
    .find((entry) => entry.result !== null);

  if (!match || match.result === null) {
    navigate(currentUser ? '/events' : '/signin', { replace: true });
    return;
  }

  if (!match.candidate.anonymous && currentUser === null) {
    await refreshSession();
    if (currentUser === null) {
      window.history.replaceState({}, '', '/signin');
      void render();
      return;
    }
  }

  const params: Record<string, string> = {};
  match.candidate.keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match.result?.[index + 1] ?? '');
  });

  activeScreen?.destroy?.();
  activeScreen = null;
  clear(main);
  renderHeader();
  const handle = match.candidate.screen({
    user: currentUser,
    params,
    navigate,
    refreshSession: async () => {
      await refreshSession();
      renderHeader();
    },
  });
  activeScreen = handle;
  main.appendChild(handle.element);
}

window.addEventListener('popstate', () => {
  void render();
});

function startsSignedOut(path: string): boolean {
  return path === '/signin' || path.startsWith('/join/');
}

void (async () => {
  if (!startsSignedOut(window.location.pathname)) await refreshSession();
  if (window.location.pathname === '/') {
    window.history.replaceState({}, '', currentUser ? '/events' : '/signin');
  }
  await render();
})();
