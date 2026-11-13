import { el } from './ui.js';
import { landingPage, registerPage, signInPage, foldersPage, notAvailablePage, notFoundPage, type PageContext } from './pages.js';
import { DrawingScreenCore, type ClientApi, type ScreenSettings, type PanelName } from './screen_core.js';
import { ReviewScreen } from './review.js';

// ---------------------------------------------------------------------------
// Entry point: a tiny client-side router over one server-served index page.
// ---------------------------------------------------------------------------

const settings: ScreenSettings = { toastMs: 5000, domMarginPx: 200, domCeiling: 500 };

interface SettingsResponse {
  toast_ms?: number;
  dom_margin_px?: number;
  dom_ceiling?: number;
}

const api: ClientApi = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> => {
  const options: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof Uint8Array) {
    options.body = body as unknown as BodyInit;
  } else if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers = { 'content-type': 'application/json' };
  }
  const response = await fetch(path, options);
  const contentType = response.headers.get('content-type') ?? '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  return { status: response.status, data: data as T };
};

async function loadSettings(): Promise<void> {
  const { status, data } = await api<SettingsResponse>('GET', '/api/client-settings');
  if (status === 200) {
    const received = data as SettingsResponse;
    settings.toastMs = Number(received.toast_ms ?? settings.toastMs);
    settings.domMarginPx = Number(received.dom_margin_px ?? settings.domMarginPx);
    settings.domCeiling = Number(received.dom_ceiling ?? settings.domCeiling);
  }
}

async function me(): Promise<string | null> {
  const { status, data } = await api<{ username?: string }>('GET', '/api/me');
  return status === 200 ? String((data as { username?: string }).username ?? '') : null;
}

const context: PageContext = { navigate, api, me: null };

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  void render(path);
}

async function render(path: string): Promise<void> {
  const root = document.getElementById('root');
  if (!root) return;
  const pathname = path.split('?')[0];
  if (pathname === '/' || pathname === '') {
    root.replaceChildren(landingPage(context));
    return;
  }
  if (pathname === '/register') {
    root.replaceChildren(registerPage(context));
    return;
  }
  if (pathname === '/signin') {
    root.replaceChildren(signInPage(context));
    return;
  }
  if (pathname === '/folders') {
    context.me = await me();
    if (!context.me) {
      navigate('/signin');
      return;
    }
    root.replaceChildren(await foldersPage(context));
    return;
  }
  if (pathname.startsWith('/v/')) {
    const token = pathname.slice('/v/'.length);
    const screen = new ReviewScreen('', token, api, null, settings, { viewLink: true });
    root.replaceChildren(screen.root);
    await screen.load();
    return;
  }
  const versionsMatch = /^\/versions\/([^/]+)$/.exec(pathname);
  if (versionsMatch) {
    context.me = await me();
    if (!context.me) {
      navigate('/signin');
      return;
    }
    const versionId = decodeURIComponent(versionsMatch[1]);
    const version = await api<{ drawing_id?: string }>('GET', `/api/versions/${versionId}`);
    if (version.status !== 200) {
      root.replaceChildren(notAvailablePage('We couldn\u2019t find that version.'));
      return;
    }
    const drawingId = String((version.data as { drawing_id?: string }).drawing_id ?? '');
    const screen = new ReviewScreen(drawingId, versionId, api, context.me, settings);
    root.replaceChildren(screen.root);
    await screen.load();
    return;
  }
  const drawingMatch = /^\/drawings\/([^/]+)$/.exec(pathname);
  if (drawingMatch) {
    context.me = await me();
    if (!context.me) {
      navigate('/signin');
      return;
    }
    const drawingId = decodeURIComponent(drawingMatch[1]);
    const screen = new DrawingScreen(drawingId, api, context.me, settings, false);
    root.replaceChildren(screen.root);
    await screen.load();
    return;
  }
  root.replaceChildren(notFoundPage());
}

class DrawingScreen extends DrawingScreenCore {
  // The concrete screen wires the panel bodies for the phone and tablet strips.
  protected panelBody(name: PanelName): HTMLElement {
    return this.panelBodies.get(name) ?? el('div');
  }
}

window.addEventListener('popstate', () => {
  void render(window.location.pathname);
});

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const anchor = target.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#')) return;
  event.preventDefault();
  navigate(href);
});

async function start(): Promise<void> {
  await loadSettings();
  await render(window.location.pathname);
}

void start();

export { DrawingScreen };
