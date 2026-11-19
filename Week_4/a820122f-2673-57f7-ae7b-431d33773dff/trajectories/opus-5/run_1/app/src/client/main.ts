import { deleteJson, getJson, type Me } from './api.js';
import { COPY } from './copy.js';
import { button, clear, el, navigate, setStatus, statusRegion } from './dom.js';
import { startConnectionWatch } from './offline.js';
import { renderSignIn } from './pages/sign-in.js';
import { renderFleet } from './pages/fleet.js';
import { renderVessel } from './pages/vessel.js';
import { renderLog } from './pages/log.js';
import { renderVoyage } from './pages/voyage.js';
import { renderInspect } from './pages/inspect.js';

export type PageContext = {
  me: Me | null;
  feedback: HTMLElement;
  path: string;
  query: URLSearchParams;
};

export type Page = { element: HTMLElement; stop?: () => void };

const ME_KEY = 'sixbell.me';
const root = document.getElementById('app') as HTMLElement;
let stopCurrentPage: (() => void) | null = null;
let archiveTimer: number | null = null;

function cacheMe(me: Me | null): void {
  try {
    if (me === null) window.localStorage.removeItem(ME_KEY);
    else window.localStorage.setItem(ME_KEY, JSON.stringify(me));
  } catch {
    // Without storage the signed-in person is simply fetched again.
  }
}

function cachedMe(): Me | null {
  try {
    const raw = window.localStorage.getItem(ME_KEY);
    return raw === null ? null : (JSON.parse(raw) as Me);
  } catch {
    return null;
  }
}

async function loadMe(): Promise<Me | null> {
  const result = await getJson<Me>('/api/me');
  if (result.ok) {
    cacheMe(result.body);
    return result.body;
  }
  if (result.networkFailure) return cachedMe();
  cacheMe(null);
  return null;
}

function notFoundPage(): Page {
  return {
    element: el('div', { class: 'page' }, [el('h1', { text: COPY.pageUnknown })]),
  };
}

function header(context: PageContext, showSignOut: boolean, showArchive: boolean): HTMLElement {
  const nodes: (Node | string)[] = [el('p', { class: 'brand', text: 'Sixbell Rest Log' })];
  if (showSignOut) {
    const signOut = button('Sign out', { class: 'quiet' });
    signOut.addEventListener('click', () => {
      void deleteJson('/api/session').then(() => {
        cacheMe(null);
        navigate('/');
      });
    });
    nodes.push(signOut);
  }
  const bar = el('div', { class: 'sheet-head' }, nodes);
  const banners = el('div', { class: 'banners' }, [context.feedback]);
  if (showArchive) {
    const archive = statusRegion('Archive status', 'banner');
    banners.append(archive);
    const poll = async (): Promise<void> => {
      const result = await getJson<{ archive: string }>('/api/archive-status');
      setStatus(
        archive,
        result.ok && result.body.archive === 'unreachable' ? COPY.archiveUnreachable : '',
      );
    };
    void poll();
    archiveTimer = window.setInterval(() => {
      void poll();
    }, 5000);
  }
  return el('div', { class: 'sheet-top' }, [bar, banners]);
}

function paint(head: HTMLElement, page: Page): void {
  clear(root);
  root.append(head, page.element);
  stopCurrentPage = page.stop ?? null;
}

async function renderRoute(): Promise<void> {
  if (stopCurrentPage !== null) {
    stopCurrentPage();
    stopCurrentPage = null;
  }
  if (archiveTimer !== null) {
    window.clearInterval(archiveTimer);
    archiveTimer = null;
  }
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const feedback = statusRegion('Feedback');

  if (path.startsWith('/inspect/')) {
    const context: PageContext = { me: null, feedback, path, query };
    const page = await renderInspect(context, path.slice('/inspect/'.length));
    paint(header(context, false, false), page);
    return;
  }

  const known =
    path === '/' ||
    path === '/fleet' ||
    path === '/log' ||
    /^\/vessels\/[^/]+$/.test(path) ||
    /^\/voyage\/[^/]+\/[^/]+$/.test(path);
  if (!known) {
    const context: PageContext = { me: null, feedback, path, query };
    paint(header(context, false, false), notFoundPage());
    return;
  }

  const me = await loadMe();
  const context: PageContext = { me, feedback, path, query };

  if (me === null) {
    if (path === '/') {
      paint(header(context, false, false), await renderSignIn(context));
      return;
    }
    navigate('/');
    return;
  }

  const owner = me.role === 'owner_master';
  if (path === '/') {
    navigate(owner ? '/fleet' : '/log');
    return;
  }
  if (path === '/fleet') {
    if (!owner) {
      navigate('/log');
      return;
    }
    paint(header(context, true, true), await renderFleet(context));
    return;
  }
  if (/^\/vessels\/[^/]+$/.test(path)) {
    if (!owner) {
      navigate('/log');
      return;
    }
    paint(header(context, true, true), await renderVessel(context, path.split('/')[2] as string));
    return;
  }
  if (path === '/log') {
    if (owner) {
      navigate('/fleet');
      return;
    }
    paint(header(context, true, false), await renderLog(context));
    return;
  }
  const voyage = /^\/voyage\/([^/]+)\/([^/]+)$/.exec(path) as RegExpExecArray;
  paint(
    header(context, true, owner),
    await renderVoyage(context, voyage[1] as string, voyage[2] as string),
  );
}

window.addEventListener('popstate', () => {
  void renderRoute();
});

startConnectionWatch();
void renderRoute();

if ('serviceWorker' in window.navigator) {
  window.addEventListener('load', () => {
    void window.navigator.serviceWorker.register('/service-worker.js');
  });
}
