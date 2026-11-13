/** The page router. Signed-out pages other than sign-in and review go to /sign-in. */
import { loadSession } from './shell.js';
import { renderLibrary } from './pages/library.js';
import { renderProfile } from './pages/profile.js';
import { renderProject } from './pages/project.js';
import { renderProjects } from './pages/projects.js';
import { renderReview } from './pages/review.js';
import { renderSignIn } from './pages/sign-in.js';

async function start(): Promise<void> {
  const path = window.location.pathname;
  const review = /^\/review\/([^/]+)$/.exec(path);
  if (review !== null) {
    renderReview(decodeURIComponent(review[1]));
    return;
  }
  const session = await loadSession();
  if (path === '/sign-in') {
    if (session !== null) {
      window.location.assign('/');
      return;
    }
    renderSignIn();
    return;
  }
  if (session === null) {
    window.location.assign('/sign-in');
    return;
  }
  const project = /^\/projects\/([^/]+)$/.exec(path);
  if (project !== null) {
    await renderProject(decodeURIComponent(project[1]));
    return;
  }
  if (path === '/library') {
    await renderLibrary();
    return;
  }
  if (path === '/profile') {
    await renderProfile();
    return;
  }
  await renderProjects();
}

void start();
