/* The client entry point: reads the page state and renders the matching screen.
   Every screen shares the masthead, the live regions and the stream. */
import { api, announce, copy, el, Live, navigate, ApiFailure, type Me } from './lib.js';
import { masthead, rail, type Community, type Post, type Comment, type ModLogEntry } from './ui.js';
import { renderFeedPage } from './pages/feed.js';
import { renderCommunityPage } from './pages/community.js';
import { renderPostPage } from './pages/post.js';
import { renderSubmitPage } from './pages/submit.js';
import { renderAuthPages } from './pages/auth.js';
import { renderModLogPage, renderModToolsPage } from './pages/modtools.js';
import { renderCommunitiesPage, renderCreateCommunityPage } from './pages/communities.js';
import { renderAdminQueuePage } from './pages/admin.js';
import { renderProfilePage, renderSettingsPage, renderTwoFactorPage } from './pages/profile.js';

type AppState = { path: string; search: string };

const stateTemplate = document.getElementById('app-state');
let initialState: AppState = { path: window.location.pathname, search: window.location.search };
if (stateTemplate !== null && stateTemplate.textContent !== null) {
  try {
    initialState = JSON.parse(stateTemplate.textContent) as AppState;
  } catch { /* fall back to the window location */ }
}

const live = new Live((paused) => {
  const indicator = document.getElementById('live-indicator');
  if (indicator !== null) {
    indicator.className = `live-indicator${paused ? ' paused' : ''}`;
    indicator.replaceChildren(
      el('span', { class: 'dot', 'aria-hidden': 'true' }),
      document.createTextNode(paused ? copy.livePausedLabel : copy.live),
    );
  }
  if (paused) announce(copy.livePaused, true);
});

async function boot(): Promise<void> {
  let me: Me | null = null;
  try {
    me = await api<Me>('/api/me');
  } catch (err) {
    // Visitors are unauthenticated; a suspended session is signed out here so
    // the page renders as a visitor instead of failing everywhere.
    if (err instanceof ApiFailure && err.code === 'SUSPENDED') {
      document.cookie = 'mh_session=; Path=/; Max-Age=0';
    }
    me = null;
  }
  const app = document.getElementById('app');
  if (app === null) return;
  app.replaceChildren();
  const head = masthead(me, { paused: false });
  app.append(head.root);

  const path = initialState.path;
  const params = initialState.search;
  const frame = el('div', { class: 'frame' });
  app.append(frame);

  try {
    if (path === '/' || path === '/feed') {
      await renderFeedPage(frame, me, live, params);
    } else if (/^\/c\/[^/]+\/post\/\d+$/.test(path)) {
      await renderPostPage(frame, me, live, path, params);
    } else if (/^\/c\/[^/]+\/post\/\d+\/comment\/\d+$/.test(path)) {
      await renderPostPage(frame, me, live, path, params, true);
    } else if (/^\/c\/[^/]+\/submit$/.test(path)) {
      await renderSubmitPage(frame, me, path);
    } else if (/^\/c\/[^/]+\/about\/log$/.test(path)) {
      await renderModLogPage(frame, me, path);
    } else if (/^\/c\/[^/]+\/about\/mod$/.test(path)) {
      await renderModToolsPage(frame, me, path, live);
    } else if (/^\/c\/[^/]+$/.test(path)) {
      await renderCommunityPage(frame, me, live, path, params);
    } else if (path === '/communities') {
      await renderCommunitiesPage(frame, me);
    } else if (path === '/communities/new') {
      await renderCreateCommunityPage(frame, me);
    } else if (/^\/u\/[^/]+$/.test(path)) {
      await renderProfilePage(frame, me, path);
    } else if (path === '/signup' || path === '/login' || path === '/verify' || path === '/forgot' || path === '/reset') {
      renderAuthPages(frame, path, params);
    } else if (path === '/settings/2fa') {
      await renderTwoFactorPage(frame, me, params);
    } else if (path === '/settings') {
      await renderSettingsPage(frame, me);
    } else if (path === '/admin/reports') {
      await renderAdminQueuePage(frame, me);
    } else {
      navigate('/');
    }
  } catch (err) {
    if (err instanceof ApiFailure && err.code === 'SUSPENDED') {
      document.cookie = 'mh_session=; Path=/; Max-Age=0';
      me = null;
      head.update(null);
    } else {
      frame.append(el('p', { class: 'empty' }, 'This page could not be loaded.'));
    }
  }
}

void boot();
