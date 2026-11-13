import { ok, onEndedSession, onForbidden, request } from './api.js';
import { slides } from './copy.js';
import { keepFocusClearOfFixedLayers } from './dom.js';
import { renderHome } from './pages/home.js';
import { renderNotice } from './pages/notice.js';
import { renderSignIn } from './pages/signIn.js';
import { renderStockist } from './pages/stockist.js';
import { renderEditor } from './pages/editorPage.js';
import type { SessionInfo } from './types.js';

const ENDED_KEY = 'interval.session.ended';

function root(): HTMLElement {
  return document.getElementById('app') as HTMLElement;
}

function slide(line: string, note: string): void {
  root().innerHTML = `<div class="slide"><p class="slide-line">${line}</p><p class="slide-note">${note}</p></div>`;
}

onEndedSession(() => {
  window.sessionStorage.setItem(ENDED_KEY, 'true');
  if (window.location.pathname !== '/sign-in') window.location.assign('/sign-in');
});

onForbidden(() => {
  void request<SessionInfo>('GET', '/api/session', { silentAuth: true }).then((result) => {
    if (ok(result)) window.location.assign(result.body.role === 'editor' ? '/editor' : '/stockist');
    else window.location.assign('/sign-in');
  });
});

keepFocusClearOfFixedLayers();

async function start(): Promise<void> {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/') {
    renderHome(root());
    return;
  }

  const noticeMatch = /^\/notices\/([^/]+)$/.exec(path);
  if (noticeMatch !== null) {
    renderNotice(root(), decodeURIComponent(noticeMatch[1]));
    return;
  }

  if (path === '/sign-in') {
    const ended = window.sessionStorage.getItem(ENDED_KEY) === 'true';
    window.sessionStorage.removeItem(ENDED_KEY);
    renderSignIn(root(), ended);
    if (ended) {
      window.setInterval(() => {
        void request<SessionInfo>('GET', '/api/session', { silentAuth: true }).then((result) => {
          if (ok(result)) window.location.assign(result.body.role === 'editor' ? '/editor' : '/stockist');
        });
      }, 5_000);
    }
    return;
  }

  if (path === '/stockist' || path === '/editor') {
    const result = await request<SessionInfo>('GET', '/api/session', { silentAuth: true }).catch(() => null);
    if (result === null || !ok(result)) {
      window.location.assign('/sign-in');
      return;
    }
    const own = result.body.role === 'editor' ? '/editor' : '/stockist';
    if (own !== path) {
      window.location.assign(own);
      return;
    }
    if (path === '/stockist') renderStockist(root(), result.body);
    else renderEditor(root(), result.body);
    return;
  }

  slide(slides.notFound.line, slides.notFound.note);
}

void start();
