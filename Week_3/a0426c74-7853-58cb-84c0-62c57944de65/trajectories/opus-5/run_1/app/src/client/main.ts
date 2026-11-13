import { api, RequestFailed } from './api.js';
import { clear, el } from './dom.js';
import { authScreen } from './screens/auth.js';
import { drawingScreen } from './screens/drawing.js';
import { foldersScreen } from './screens/folders.js';
import { landingScreen } from './screens/landing.js';
import { notAvailable, viewLinkScreen } from './screens/viewlink.js';

const root = document.getElementById('app') as HTMLElement;

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  void render();
}

async function render(): Promise<void> {
  const path = window.location.pathname;
  if (path === '/') {
    landingScreen(root);
    return;
  }
  if (path === '/signin' || path === '/register') {
    authScreen(root, path === '/signin' ? 'signin' : 'register', navigate);
    return;
  }
  if (path === '/folders') {
    await foldersScreen(root, navigate);
    return;
  }
  const drawing = /^\/drawings\/([^/]+)$/.exec(path);
  if (drawing) {
    clear(root);
    try {
      await drawingScreen(root, decodeURIComponent(drawing[1]));
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'unauthenticated') {
        navigate('/signin');
        return;
      }
      notAvailable(root, 'We couldn\u2019t find that page.');
    }
    return;
  }
  const version = /^\/versions\/([^/]+)$/.exec(path);
  if (version) {
    clear(root);
    try {
      const payload = await api.get<{ id: string; drawing_id: string }>(`/api/versions/${decodeURIComponent(version[1])}`);
      await drawingScreen(root, payload.drawing_id, { versionId: payload.id, readOnly: true });
    } catch (error) {
      if (error instanceof RequestFailed && error.body.error === 'unauthenticated') {
        navigate('/signin');
        return;
      }
      notAvailable(root, 'We couldn\u2019t find that page.');
    }
    return;
  }
  const link = /^\/v\/([^/]+)$/.exec(path);
  if (link) {
    await viewLinkScreen(root, decodeURIComponent(link[1]));
    return;
  }
  clear(root);
  root.append(el('main', { class: 'surface not-available' }, [el('p', {}, ['We couldn\u2019t find that page.'])]));
}

window.addEventListener('popstate', () => void render());
void render();
