// The browser entry: routing between screens.

import { apiGet, setCsrfToken, validNext, decodeNextParam, SessionUser } from './api.js';
import { renderSignIn, renderDiagrams } from './screens.js';
import { renderEditor } from './editor.js';
import { renderInvitePage } from './invite.js';
import { COPY } from '../shared/constants.js';

export interface AppState {
  user: SessionUser | null;
}

export const state: AppState = { user: null };

export function encodeNext(pathAndQuery: string): string {
  return pathAndQuery.replace(/[^A-Za-z0-9\-_.!~*'()]/g, (ch) =>
    Array.from(new TextEncoder().encode(ch)).map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''));
}

export function navigate(path: string, replace = false): void {
  if (replace) {
    history.replaceState(null, '', path);
  } else {
    history.pushState(null, '', path);
  }
  void route();
}

export async function route(): Promise<void> {
  const path = location.pathname;
  const root = document.getElementById('root') as HTMLElement;
  root.innerHTML = '';

  // Load the session; the server renders HTML for every route, and the
  // browser app decides its screen from the same addresses.
  if (state.user === null) {
    try {
      const session = await apiGet('/api/session') as { user: SessionUser; csrfToken: string };
      state.user = session.user;
      setCsrfToken(session.csrfToken);
    } catch {
      state.user = null;
      setCsrfToken(null);
    }
  }

  if (path === '/signin') {
    if (state.user !== null) {
      const params = new URLSearchParams(location.search);
      const next = validNext(decodeNextParam(params.get('next') ?? ''));
      navigate(next ?? '/', true);
      return;
    }
    root.appendChild(renderSignIn());
    return;
  }

  if (path.startsWith('/invite/')) {
    root.appendChild(renderInvitePage(path.slice('/invite/'.length), state.user));
    return;
  }

  if (path === '/' || path.startsWith('/d/')) {
    if (state.user === null) {
      navigate(`/signin?next=${encodeNext(path + location.search)}`, true);
      return;
    }
    if (path === '/') {
      root.appendChild(renderDiagrams(state.user));
      return;
    }
    const match = path.match(/^\/d\/([^/]+)(?:\/p\/([^/]+))?$/);
    if (match === null) {
      root.appendChild(notFoundScreen());
      return;
    }
    const diagramId = decodeURIComponent(match[1]);
    const pageId = match[2] !== undefined ? decodeURIComponent(match[2]) : null;
    await renderEditor(root, diagramId, pageId, state);
    return;
  }

  root.appendChild(notFoundScreen());
}

export function notFoundScreen(): HTMLElement {
  const main = document.createElement('main');
  main.className = 'notfound';
  const h1 = document.createElement('h1');
  h1.textContent = COPY.pageNotFoundHeading;
  const p = document.createElement('p');
  p.textContent = COPY.pageNotFoundText;
  main.append(h1, p);
  return main;
}

export function diagramNotFoundScreen(): HTMLElement {
  const main = document.createElement('main');
  main.className = 'notfound';
  const h1 = document.createElement('h1');
  h1.textContent = COPY.diagramNotFoundHeading;
  const p = document.createElement('p');
  p.textContent = COPY.diagramNotFoundText;
  main.append(h1, p);
  return main;
}

// Sign out ends every session and lands on /signin with no next.
export async function signOut(): Promise<void> {
  const { apiDelete } = await import('./api.js');
  try {
    await apiDelete('/api/session');
  } catch {
    // Signing out proceeds even if the request fails.
  }
  state.user = null;
  setCsrfToken(null);
  navigate('/signin', true);
}

export function renderApp(_root: HTMLElement): void {
  window.addEventListener('popstate', () => {
    void route();
  });
  void route();
}
