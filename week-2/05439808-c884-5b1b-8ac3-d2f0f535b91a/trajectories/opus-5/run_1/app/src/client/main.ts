import '@fontsource/fraunces/600.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';

import { onSessionEnded } from './api.js';
import { noticeCopy } from './copy.js';
import { el } from './dom.js';
import { alertNotice, mountRegions, notice } from './regions.js';
import { currentPath, navigate, startRouter, takeSignedOutNotice } from './router.js';
import {
  loadCatalog,
  loadSession,
  pollOnce,
  startPolling,
  state,
  subscribe,
  type PanelName
} from './store.js';
import {
  forgotScreen,
  resetScreen,
  signInScreen,
  signUpScreen,
  verifyScreen
} from './screens/auth.js';
import { opsScreen } from './screens/ops.js';
import { raidScreen } from './screens/raid.js';
import { replayScreen } from './screens/replay.js';
import { scoutScreen } from './screens/scout.js';
import { villageScreen } from './screens/village.js';
import type { Screen } from './screens/types.js';
import { createShell, type Shell } from './ui/shell.js';

const root = el('div', { class: 'app-root' });
document.body.append(root);
mountRegions(root);

const content = el('div', { class: 'content' });
root.append(content);

let shell: Shell | null = null;
let screen: Screen | null = null;
let renderedKey = '';

const PANEL_ROUTES: Record<string, PanelName> = {
  '/raid-log': 'raidLog',
  '/clan': 'clan',
  '/league': 'league',
  '/rewards': 'rewards',
  '/profile': 'profile'
};

const AUTH_PATHS = ['/signin', '/signup', '/forgot', '/reset', '/verify'];
const OPERATOR_PATHS = ['/', '/ops', '/league', '/profile'];

function clearScreen(): void {
  screen?.dispose();
  screen = null;
}

function mountAuth(path: string): void {
  clearScreen();
  shell = null;
  content.replaceChildren();
  const token = new URL(window.location.href).searchParams.get('token') ?? '';
  const made =
    path === '/signup'
      ? signUpScreen()
      : path === '/forgot'
        ? forgotScreen()
        : path === '/reset'
          ? resetScreen(token)
          : path === '/verify'
            ? verifyScreen(token)
            : signInScreen();
  content.append(made.node);
  if (path === '/signin' && takeSignedOutNotice()) notice(noticeCopy.signedOut);
}

function ensureShell(): Shell {
  if (shell !== null) return shell;
  content.replaceChildren();
  const made = createShell();
  content.append(made.node);
  shell = made;
  return made;
}

function screenFor(path: string, host: Shell): Screen | null {
  const replay = /^\/raids\/(\d+)\/replay$/.exec(path);
  if (replay) {
    const tick = Number(new URL(window.location.href).searchParams.get('tick') ?? '0');
    return replayScreen(Number(replay[1]), Number.isFinite(tick) ? tick : 0);
  }
  const raid = /^\/raids\/(\d+)$/.exec(path);
  if (raid) return raidScreen(Number(raid[1]), host);
  const scoutSpecific = /^\/scout\/(\d+)$/.exec(path);
  if (scoutSpecific) return scoutScreen(Number(scoutSpecific[1]));
  if (path === '/scout') return scoutScreen(null);
  if (path === '/ops') return opsScreen();
  if (path === '/' || path in PANEL_ROUTES) return villageScreen(PANEL_ROUTES[path] ?? null);
  return null;
}

async function render(path: string): Promise<void> {
  if (AUTH_PATHS.includes(path)) {
    mountAuth(path);
    renderedKey = path;
    return;
  }
  await loadSession();
  if (state.user === null) {
    navigate('/signin', true);
    return;
  }
  if (state.user.role === 'operator' && !OPERATOR_PATHS.includes(path)) {
    navigate('/ops', true);
    return;
  }
  if (path === '/ops' && state.user.role !== 'operator') {
    navigate('/', true);
    return;
  }
  const host = ensureShell();
  const key = `${path}${window.location.search}`;
  if (key === renderedKey && screen !== null) return;
  renderedKey = key;
  clearScreen();
  host.stage.replaceChildren();
  host.panelHost.replaceChildren();
  const made = screenFor(path, host);
  if (made === null) {
    navigate('/', true);
    return;
  }
  screen = made;
  made.mount(host.stage, host.panelHost);
  host.update();
  await pollOnce();
  host.update();
  made.update();
}

subscribe(() => {
  shell?.update();
  screen?.update();
});

onSessionEnded(() => {
  if (state.user === null) return;
  state.user = null;
  state.village = null;
  alertNotice(noticeCopy.sessionEnded);
  navigate('/signin');
});

window.setInterval(() => {
  shell?.update();
  screen?.update();
}, 1000);

async function boot(): Promise<void> {
  await loadSession();
  await loadCatalog();
  startRouter((path) => {
    void render(path);
  });
  startPolling();
  if (state.user === null && !AUTH_PATHS.includes(currentPath())) navigate('/signin', true);
}

void boot();
