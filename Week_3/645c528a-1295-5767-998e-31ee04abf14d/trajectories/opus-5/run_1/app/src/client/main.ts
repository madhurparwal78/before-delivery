import { HOME_COPY, num } from '../shared/copy.js';
import { el, statusRegion } from './dom.js';
import { navigate, setNavigator, type Screen, type ScreenBuilder } from './navigate.js';
import { clubScreen, clubsScreen } from './screens/clubs.js';
import { homeScreen } from './screens/home.js';
import { leaderboardScreen } from './screens/leaderboards.js';
import { addFriendScreen, inviteScreen, notFoundScreen, verifyScreen } from './screens/misc.js';
import { modePickerScreen, tierPickerScreen } from './screens/play.js';
import { practiceSetupScreen } from './screens/practice.js';
import { profileScreen } from './screens/profile.js';
import { settingsScreen } from './screens/settings.js';
import { shopScreen } from './screens/shop.js';
import { onlineTableScreen, practiceTableScreen, tutorialScreen } from './screens/table.js';
import { bracketScreen, tournamentsScreen } from './screens/tournaments.js';
import {
  applyGuestSettings,
  readCachedChips,
  refreshMe,
  setTopics,
  state,
  subscribe,
  topicsFor,
  tutorialFinished,
  watchConnectivity,
  watchMotionPreference,
} from './state.js';

interface Route {
  pattern: string;
  build: ScreenBuilder;
}

const routes: Route[] = [
  { pattern: '/home', build: () => homeScreen() },
  { pattern: '/play', build: (context) => tierPickerScreen(context) },
  { pattern: '/play/special', build: () => modePickerScreen() },
  { pattern: '/table/:id', build: (context) => onlineTableScreen(context) },
  { pattern: '/practice', build: () => practiceSetupScreen() },
  { pattern: '/practice/table', build: (context) => practiceTableScreen(context) },
  { pattern: '/shop', build: () => shopScreen() },
  { pattern: '/tournaments', build: () => tournamentsScreen() },
  { pattern: '/tournaments/:id', build: (context) => bracketScreen(context) },
  { pattern: '/clubs', build: () => clubsScreen() },
  { pattern: '/clubs/:id', build: (context) => clubScreen(context) },
  { pattern: '/leaderboards', build: () => leaderboardScreen() },
  { pattern: '/profile', build: () => profileScreen() },
  { pattern: '/settings', build: () => settingsScreen() },
  { pattern: '/verify', build: (context) => verifyScreen(context) },
  { pattern: '/invite/:token', build: (context) => inviteScreen(context) },
  { pattern: '/friends/add/:code', build: (context) => addFriendScreen(context) },
];

const header = el('header', { className: 'thin-header' });
const coinsChip = el('span', { className: 'chip', attrs: { role: 'status', 'aria-label': 'Coins', 'aria-live': 'polite' } });
const cashChip = el('span', { className: 'chip', attrs: { role: 'status', 'aria-label': 'Cash', 'aria-live': 'polite' } });
const headerConnection = statusRegion('Connection', 'notice connection');
header.append(coinsChip, cashChip, headerConnection);
const main = el('main', { className: 'screen', id: 'main' });

let active: Screen | null = null;
let activePath = '';

function matchRoute(pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    const expected = route.pattern.split('/').filter(Boolean);
    if (expected.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < expected.length; index += 1) {
      const token = expected[index] as string;
      const value = parts[index] as string;
      if (token.startsWith(':')) params[token.slice(1)] = decodeURIComponent(value);
      else if (token !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

function updateHeader(path: string): void {
  const onHome = path === '/home' || path === '/';
  header.hidden = !state.me || onHome;
  if (header.hidden) return;
  const cached = state.cachedChips ?? readCachedChips();
  const coins = state.me ? state.me.coins : cached?.coins ?? 0;
  const cash = state.me ? state.me.cash : cached?.cash ?? 0;
  coinsChip.textContent = state.storeDown ? `${num(coins)} ${HOME_COPY.stale}` : num(coins);
  cashChip.textContent = state.storeDown ? `${num(cash)} ${HOME_COPY.stale}` : num(cash);
  headerConnection.textContent = state.storeDown ? HOME_COPY.storeDown : '';
}

function render(path: string, search: string): void {
  const url = new URL(`${path}${search}`, window.location.origin);
  if (path === '/') {
    if (!state.me && !tutorialFinished()) {
      mount(tutorialScreen(), path);
      return;
    }
    navigate('/home', { replace: true });
    return;
  }
  const matched = matchRoute(path);
  if (!matched) {
    mount(notFoundScreen(), path);
    return;
  }
  mount(matched.route.build({ params: matched.params, url }), path);
}

function mount(screen: Screen, path: string): void {
  active?.destroy?.();
  active = screen;
  activePath = path;
  main.replaceChildren(screen.element);
  setTopics(topicsFor(screen.topics ?? []));
  updateHeader(path);
  window.scrollTo(0, 0);
}

setNavigator((path, options) => {
  const [pathname, query] = path.split('?');
  const search = query ? `?${query}` : '';
  if (options?.replace) window.history.replaceState({}, '', `${pathname}${search}`);
  else window.history.pushState({}, '', `${pathname}${search}`);
  render(pathname ?? '/', search);
});

window.addEventListener('popstate', () => render(window.location.pathname, window.location.search));

subscribe(() => {
  updateHeader(activePath);
  active?.update?.();
});

async function boot(): Promise<void> {
  document.body.append(header, main);
  applyGuestSettings();
  watchConnectivity();
  watchMotionPreference();
  if (navigator.onLine) await refreshMe();
  else state.cachedChips = readCachedChips();
  render(window.location.pathname, window.location.search);
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/service-worker.js');
  }
}

void boot();
