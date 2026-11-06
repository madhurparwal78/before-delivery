/**
 * The application bootstrap: build the chrome, load the signed-in account, and
 * register every route before the first render.
 */

import * as api from './api.js';
import { buildChrome } from './chrome.js';
import { bindNavigation, renderCurrent, route, startRefreshLoop } from './router.js';
import { state } from './state.js';
import { renderHome } from './pages/home.js';
import { renderSpeakers } from './pages/speakers.js';
import './pages/agenda.js';
import './pages/session.js';
import './pages/my-agenda.js';
import './pages/record.js';
import './pages/organiser.js';
import './pages/auth-form.js';
import './pages/notfound.js';

route(/^\/$/, renderHome);
route(/^\/speakers$/, renderSpeakers);

async function boot(): Promise<void> {
  buildChrome();
  bindNavigation();
  // The account is read from the stored token; the server decides everything.
  if (api.storedToken() !== null) {
    const me = await api.getMe().catch(() => null);
    if (me === null) api.storeToken(null);
    state.account = me;
    const { renderAccountControls } = await import('./chrome.js');
    renderAccountControls(document.querySelector('.account-controls') as HTMLElement);
  }
  await renderCurrent();
  startRefreshLoop();
}

void boot();
