import { renderHome } from './screens/home.js';
import { renderAuth, renderMaps } from './screens/maps-list.js';
import { renderEditor } from './screens/editor.js';
import { renderAudience } from './screens/audience.js';
import { renderShareEntry, renderRemoved, renderNotFound } from './screens/share-entry.js';
import { renderVersionView } from './screens/version-view.js';
import { initNotices } from './lib/api.js';
import { el, openDialog } from './lib/dom.js';
import { api } from './lib/api.js';

/**
 * Client routing: the published routes and nothing more.
 */

const app = document.getElementById('app')!;

async function route(): Promise<void> {
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  if (path === '/' ) { renderHome(app); return; }
  if (path === '/signup') { renderAuth(app, 'signup'); return; }
  if (path === '/signin') { renderAuth(app, 'signin'); return; }
  if (path === '/maps') { void renderMaps(app); return; }
  const editorMatch = path.match(/^\/m\/([^/]+)$/);
  if (editorMatch) { void renderEditor(app, editorMatch[1], query); return; }
  const versionMatch = path.match(/^\/m\/([^/]+)\/versions\/([^/]+)$/);
  if (versionMatch) { void renderVersionView(app, versionMatch[1], versionMatch[2], query); return; }
  const shareMatch = path.match(/^\/s\/([^/]+)$/);
  if (shareMatch) { void renderShareEntry(app, shareMatch[1]); return; }
  const audienceMatch = path.match(/^\/p\/([^/]+)$/);
  if (audienceMatch) { renderAudience(app, audienceMatch[1]); return; }
  if (path === '/removed') { renderRemoved(app); return; }
  renderNotFound(app);
}

initNotices();

// Session expiry: the Sign in again dialog cannot be dismissed.
window.addEventListener('sprig-session-expired', () => {
  openDialog({
    label: 'Sign in again',
    dismissible: false,
    build(body, close) {
      body.appendChild(el('h2', {}, 'Sign in again'));
      body.appendChild(el('p', {}, 'Your session ended. Sign in again to keep your changes.'));
      const label = el('label', { for: 'signin-password' }, 'Password');
      const field = el('input', { id: 'signin-password', type: 'password', 'aria-label': 'Password' }) as HTMLInputElement;
      const submit = el('button', { class: 'primary', 'aria-label': 'Sign in' }, 'Sign in');
      submit.addEventListener('click', async () => {
        const res = await api('/api/auth/login', 'POST', { username: '', password: field.value });
        if (res.ok) close();
      });
      body.append(label, field, submit);
    },
  });
});

window.addEventListener('sprig-link-expired', () => {
  location.href = '/removed';
});

window.addEventListener('popstate', () => { void route(); });
void route();
