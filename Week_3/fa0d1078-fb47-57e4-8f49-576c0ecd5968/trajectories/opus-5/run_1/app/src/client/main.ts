import type { PlayerShape } from '../shared/api';
import { M } from '../shared/messages';
import { api, ApiFailure } from './api';
import { announce, announcerElement } from './announcer';
import { button, clear, el } from './dom';
import { pending } from './pending';
import { renderAccountPage, type AccountKind } from './pages/account';
import { renderDaily } from './pages/daily';
import { renderDuel } from './pages/duel';
import { renderHome } from './pages/home';
import { renderLeaderboard } from './pages/leaderboard';
import { renderNotFound } from './pages/notfound';
import { renderPlay } from './pages/play';
import { renderProfile } from './pages/profile';
import { renderRoom } from './pages/room';
import './styles.css';

export type Cleanup = () => void;

export interface PageContext {
  main: HTMLElement;
  params: Record<string, string>;
  player: PlayerShape | null;
}

interface Route {
  pattern: RegExp;
  names: string[];
  page: (context: PageContext) => Promise<Cleanup | void> | Cleanup | void;
  open: boolean;
  bodyClass: string;
}

const routes: Route[] = [
  { pattern: /^\/$/, names: [], page: renderHome, open: true, bodyClass: 'page-home' },
  { pattern: /^\/play\/([^/]+)$/, names: ['id'], page: renderPlay, open: false, bodyClass: 'page-play' },
  { pattern: /^\/daily$/, names: [], page: renderDaily, open: false, bodyClass: 'page-daily' },
  {
    pattern: /^\/leaderboard$/,
    names: [],
    page: renderLeaderboard,
    open: false,
    bodyClass: 'page-leaderboard',
  },
  {
    pattern: /^\/leaderboard\/([^/]+)$/,
    names: ['date'],
    page: renderLeaderboard,
    open: false,
    bodyClass: 'page-leaderboard',
  },
  { pattern: /^\/duel$/, names: [], page: renderDuel, open: false, bodyClass: 'page-duel' },
  { pattern: /^\/duel\/([^/]+)$/, names: ['code'], page: renderRoom, open: false, bodyClass: 'page-room' },
  { pattern: /^\/profile$/, names: [], page: renderProfile, open: false, bodyClass: 'page-profile' },
  ...accountRoute('/signin', 'signin'),
  ...accountRoute('/signup', 'signup'),
  ...accountRoute('/reset', 'reset-request'),
  ...accountRoute('/reset/([^/]+)', 'reset-confirm', ['token']),
  ...accountRoute('/verify/([^/]+)', 'verify', ['token']),
];

function accountRoute(path: string, kind: AccountKind, names: string[] = []): Route[] {
  return [
    {
      pattern: new RegExp(`^${path}$`),
      names,
      page: (context) => renderAccountPage(context, kind),
      open: true,
      bodyClass: 'page-account',
    },
  ];
}

let player: PlayerShape | null = null;
let cleanup: Cleanup | null = null;

const navElement = el('nav', { 'aria-label': 'Main', class: 'main-nav' });
const bannerSlot = el('div', { class: 'banner-slot' });
const mainElement = el('main', { class: 'main' });

export function currentPlayer(): PlayerShape | null {
  return player;
}

export function setPlayer(next: PlayerShape | null): void {
  player = next;
  renderNav();
  renderBanner();
}

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  void renderRoute();
}

function link(label: string, href: string): HTMLAnchorElement {
  const anchor = el('a', { href }, [label]);
  anchor.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  });
  return anchor;
}

function renderNav(): void {
  clear(navElement);
  const links = [
    link('Seam', '/'),
    link('Daily', '/daily'),
    link('Duel', '/duel'),
    link('Leaderboard', '/leaderboard'),
    link('Profile', '/profile'),
  ];
  for (const anchor of links) navElement.append(anchor);
  if (player) {
    const signOut = button('Sign out', { class: 'nav-action' });
    signOut.addEventListener('click', () => {
      void pending(signOut, null, async () => {
        await api.post('/api/auth/signout').catch(() => undefined);
        setPlayer(null);
        navigate('/signin');
      });
    });
    navElement.append(signOut);
  } else {
    navElement.append(link('Sign in', '/signin'), link('Create account', '/signup'));
  }
}

function renderBanner(): void {
  clear(bannerSlot);
  if (!player || player.verified) return;
  const resend = button('Send again', { class: 'banner-action' });
  resend.addEventListener('click', () => {
    void pending(resend, null, async () => {
      try {
        await api.post('/api/auth/verify/resend');
        announce(M.confirmationResent);
      } catch (cause) {
        announce(noticeFor(cause));
      }
    });
  });
  bannerSlot.append(
    el('section', { role: 'region', 'aria-label': 'Email confirmation', class: 'banner' }, [
      el('p', {}, [M.confirmEmailBanner]),
      resend,
    ]),
  );
}

export function noticeFor(cause: unknown): string {
  if (!(cause instanceof ApiFailure)) return M.unexpected;
  switch (cause.code) {
    case 'STORAGE_UNAVAILABLE':
      return M.storageUnavailable;
    case 'MAIL_UNAVAILABLE':
      return M.mailUnavailable;
    case 'LIVE_UNAVAILABLE':
      return M.liveUnavailable;
    case 'NOT_VERIFIED':
      return M.notVerifiedDuel;
    case 'RATE_LIMITED':
      return M.rateLimited;
    case 'ROOM_NOT_FOUND':
      return M.roomNotFound;
    case 'ROOM_FULL':
      return M.roomFull;
    case 'BAD_CREDENTIALS':
      return M.badCredentials;
    default:
      return M.unexpected;
  }
}

async function renderRoute(): Promise<void> {
  cleanup?.();
  cleanup = null;
  clear(mainElement);
  const path = location.pathname;
  const matched = routes
    .map((route) => ({ route, found: route.pattern.exec(path) }))
    .find((candidate) => candidate.found !== null);

  if (!matched?.found) {
    document.body.className = 'page-notfound';
    renderNotFound(mainElement, M.pageNotFound);
    return;
  }

  if (!matched.route.open && !player) {
    const next = encodeURIComponent(path + location.search);
    navigate(`/signin?next=${next}`, true);
    return;
  }
  const params: Record<string, string> = {};
  matched.route.names.forEach((name, index) => {
    params[name] = decodeURIComponent(matched.found?.[index + 1] ?? '');
  });

  document.body.className = matched.route.bodyClass;
  const result = await matched.route.page({ main: mainElement, params, player });
  cleanup = typeof result === 'function' ? result : null;
}

async function boot(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  app.append(navElement, announcerElement(), bannerSlot, mainElement);
  try {
    const me = await api.get<{ player: PlayerShape }>('/api/me');
    player = me.player;
  } catch {
    player = null;
  }
  renderNav();
  renderBanner();
  window.addEventListener('popstate', () => void renderRoute());
  await renderRoute();
}

void boot();
