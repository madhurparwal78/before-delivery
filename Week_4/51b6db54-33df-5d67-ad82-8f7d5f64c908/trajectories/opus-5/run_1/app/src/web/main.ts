import { landingPage } from './pages/landing.js';
import { signInPage, signUpPage } from './pages/auth.js';
import { invitePage } from './pages/invite.js';
import { projectPage } from './pages/project.js';
import { projectsPage } from './pages/projects.js';
import { sharePage } from './pages/share.js';
import { route, startRouter } from './router.js';
import { loadBusinessClock, loadMe, startRelativeTicker } from './session.js';
import { workspacePage } from './workspace/index.js';

async function start(): Promise<void> {
  await loadMe();
  await loadBusinessClock();
  window.setInterval(() => void loadBusinessClock(), 1500);
  startRelativeTicker();

  route(/^\/$/, () => landingPage());
  route(/^\/signup$/, () => signUpPage());
  route(/^\/signin$/, () => signInPage());
  route(/^\/projects$/, () => projectsPage());
  route(/^\/projects\/(\d+)$/, (params) => projectPage(params));
  route(/^\/projects\/(\d+)\/sprites\/(\d+)$/, (params) => workspacePage(params));
  route(/^\/invites\/([^/]+)$/, (params) => invitePage(params));
  route(/^\/s\/([^/]+)$/, (params) => sharePage(params));

  const host = document.getElementById('app');
  if (host !== null) startRouter(host);
}

void start();
