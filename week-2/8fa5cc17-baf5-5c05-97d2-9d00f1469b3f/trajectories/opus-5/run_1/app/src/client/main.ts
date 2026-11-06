import { api, setCsrfToken, setUnauthenticatedHandler, SessionInfo } from './api';
import { clear, el } from './dom';
import { mountFrame, frame } from './frame';
import { registerRoutes, startRouter, Screen, navigate } from './router';
import { loadWorkspace, refreshLibrary, setHomeZone, setTheme } from './state';
import { showSignIn } from './screens/signin';
import { objectScreen } from './screens/object';
import { typePageScreen, openNewTypeDialog } from './screens/typepage';
import { collectionScreen } from './screens/collection';
import { boardScreen } from './screens/board';
import { timelineScreen } from './screens/timeline';
import { queriesScreen } from './screens/queries';
import { graphScreen } from './screens/graph';
import { settingsScreen } from './screens/settings';
import { openPalette } from './components/palette';
import { startLiveSync, onLive, stopLiveSync } from './live';
import { COPY } from '../shared/copy';
import { isThemeName } from '../shared/tokens';

const host = document.getElementById('quire-root') as HTMLElement;

function notFoundScreen(): Screen {
  return {
    async mount(): Promise<void> {
      clear(frame().main);
      clear(frame().margin);
      frame().main.append(el('h1', { text: COPY.notFound, attrs: { tabindex: '-1' } }));
    },
  };
}

function redirectScreen(path: string): Screen {
  return {
    async mount(): Promise<void> {
      navigate(path, { replace: true, reveal: path === '/today' });
    },
  };
}

function signedOut(message?: string): void {
  stopLiveSync();
  const here = `${window.location.pathname}${window.location.search}`;
  const alreadyThere = window.location.pathname === '/sign-in';
  const returnPath = alreadyThere ? new URL(window.location.href).searchParams.get('return') : here;
  if (!alreadyThere) {
    window.history.replaceState({}, '', `/sign-in?return=${encodeURIComponent(here)}`);
  }
  showSignIn(host, { returnPath, message }, (session) => void startWorkspace(session));
}

async function startWorkspace(session: SessionInfo): Promise<void> {
  clear(host);
  setCsrfToken(session.csrf_token);
  await loadWorkspace(session);
  document.documentElement.setAttribute('data-theme', session.theme);
  const workspaceFrame = mountFrame(host);
  workspaceFrame.renderRail();
  startLiveSync();

  registerRoutes([
    { pattern: '/', screen: () => redirectScreen('/today') },
    { pattern: '/today', screen: () => objectScreen('today') },
    { pattern: '/o/:id', screen: () => objectScreen('object') },
    { pattern: '/types/:id', screen: typePageScreen },
    { pattern: '/collections/:id', screen: collectionScreen },
    { pattern: '/collections/:id/board', screen: boardScreen },
    { pattern: '/timeline', screen: timelineScreen },
    { pattern: '/queries', screen: queriesScreen },
    { pattern: '/queries/:id', screen: queriesScreen },
    { pattern: '/graph', screen: graphScreen },
    { pattern: '/settings', screen: settingsScreen },
    { pattern: '*', screen: notFoundScreen },
  ]);

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette(document.activeElement as HTMLElement | null);
    }
  });
  document.addEventListener('quire:new-type', (event) => {
    const detail = (event as CustomEvent<{ opener: HTMLElement | null }>).detail;
    openNewTypeDialog(detail?.opener ?? null);
  });

  onLive((type, data) => {
    if (type === 'session.ended') {
      signedOut(COPY.signedOutElsewhere);
      return;
    }
    if (type === 'settings.saved') {
      const theme = data['theme'];
      if (isThemeName(theme)) setTheme(theme);
      const zone = data['home_time_zone'];
      if (typeof zone === 'string') setHomeZone(zone);
      return;
    }
    if (type === 'object.saved' || type === 'object.removed') {
      void (async () => {
        await refreshLibrary();
        frame().renderRail();
      })();
    }
  });

  if (window.location.pathname === '/sign-in') {
    window.history.replaceState({}, '', '/today');
  }
  startRouter();
}

async function boot(): Promise<void> {
  setUnauthenticatedHandler(() => signedOut(COPY.signedOutElsewhere));
  const result = await api.get<SessionInfo>('/api/session');
  if (!result.ok) {
    const url = new URL(window.location.href);
    const here = url.pathname === '/sign-in' ? url.searchParams.get('return') : `${url.pathname}${url.search}`;
    if (url.pathname !== '/sign-in') {
      window.history.replaceState({}, '', `/sign-in?return=${encodeURIComponent(here ?? '/today')}`);
    }
    showSignIn(host, { returnPath: here }, (session) => void startWorkspace(session));
    return;
  }
  await startWorkspace(result.data);
}

void boot();
