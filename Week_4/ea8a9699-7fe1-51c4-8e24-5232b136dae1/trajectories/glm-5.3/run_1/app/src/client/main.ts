// Client entry point: routes and mount.

import { el, loadSession, mountApp, route } from './lib.js';
import { renderSignIn, renderSignUp, renderInvite } from './screens/signin.js';
import { renderWall } from './screens/wall.js';
import { renderSettings } from './screens/settings.js';
import { renderAdmin } from './screens/admin.js';
import { renderExplore } from './screens/explore.js';
import { renderProfile, renderPublicCluster } from './screens/profile.js';
import { renderReview } from './screens/review.js';

// Public routes ---------------------------------------------------------
route('/', async () => {
  window.location.replace('/explore');
  return el('div');
});
route('/signin', async (_m, params) => renderSignIn(params));
route('/signup', async (_m, params) => renderSignUp(params));
route('/invite/([^/]+)', async (m) => renderInvite(m[1]!));
route('/explore', async (_m, params) => renderExplore(params));
route('/@([^/]+)', async (m) => renderProfile(m[1]!));
route('/c/([^/]+)', async (m) => renderPublicCluster(m[1]!));
route('/review/([^/]+)', async (m) => renderReview(m[1]!));
route('/w/([^/]+)', async (m, params) => renderWall(m[1]!, params));
route('/w/([^/]+)/admin', async (m, params) => renderAdmin(m[1]!, params));
route('/w/([^/]+)/clusters/([^/]+)', async (m, params) => renderSettings(m[1]!, m[2]!));

async function boot(): Promise<void> {
  await loadSession();
  await mountApp();
}

window.addEventListener('popstate', () => {
  void mountApp();
});

void boot();
