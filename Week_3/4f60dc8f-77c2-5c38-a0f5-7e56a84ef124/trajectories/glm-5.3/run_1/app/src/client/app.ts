import { mountShell } from './shell';
import { mountNotFound } from './pages/notfound';

const path = window.location.pathname;
mountShell();

if (path === '/' || path.startsWith('/#')) {
  void import('./pages/home').then(m => m.mountHome());
} else if (path.startsWith('/work/')) {
  void import('./pages/casestudy').then(m => m.mountCaseStudy(path));
} else if (path === '/start') {
  void import('./pages/start').then(m => m.mountStart());
} else if (path === '/sign-in') {
  void import('./pages/signin').then(m => m.mountSignIn());
} else if (path === '/account') {
  void import('./pages/account').then(m => m.mountAccount());
} else if (path.startsWith('/account/engagements/')) {
  void import('./pages/account').then(m => m.mountEngagement(path));
} else if (path.startsWith('/rig/')) {
  void import('./pages/rig').then(m => m.mountRig(path));
} else if (path.startsWith('/review/')) {
  void import('./pages/review').then(m => m.mountReview(path));
} else if (path === '/studio') {
  void import('./pages/studio').then(m => m.mountStudio());
} else if (path.startsWith('/studio/engagements/')) {
  void import('./pages/studio').then(m => m.mountStudioEngagement(path));
} else {
  mountNotFound();
}
