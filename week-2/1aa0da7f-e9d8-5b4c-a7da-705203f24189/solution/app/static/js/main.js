// Boot: find the session, register the routes, draw the address.

import { api, ConnectionLost, h, session } from './core.js';
import { addRoute, homeOf, matchRoute, notFoundContent, noticeSlot, renderRoute, root, startServiceChecks } from './shell.js';

const ID = '([^/]+)';
const SESSION_RETRY_MS = 2000;

function onlyFor(role, load) {
  return async () => (session.me?.role === role ? load() : { mount: (screen) => screen.notFound() });
}

addRoute(/^\/sign-in$/, () => import('./screens/sign_in.js'), { public: true, keepFocus: true });
addRoute(new RegExp(`^/compartments$`), () => import('./screens/compartments.js'));
addRoute(new RegExp(`^/compartments/${ID}$`), () => import('./screens/docket.js'));
addRoute(new RegExp(`^/exhibits/${ID}$`), () => import('./screens/exhibit.js'), { keepFocus: true });
addRoute(new RegExp(`^/releases/${ID}$`), () => import('./screens/release.js'), { keepFocus: true });
addRoute(/^\/reviews$/, onlyFor('case_lead', () => import('./screens/reviews.js')));
addRoute(/^\/intake$/, onlyFor('intake_officer', () => import('./screens/intake.js')));
addRoute(/^\/ledger$/, onlyFor('auditor', () => import('./screens/walk.js')), { keepFocus: true });
addRoute(/^\/ledger\/review$/, onlyFor('auditor', () => import('./screens/review.js')));
addRoute(/^\/audit\/chain$/, onlyFor('auditor', () => import('./screens/lattice.js')), { keepFocus: true });
addRoute(new RegExp(`^/l/${ID}$`), () => import('./screens/link.js'), { public: true, keepFocus: true });

// A lost connection or a database still starting says nothing about the session, so a signed-in route asks again.
async function findSession(keepAsking) {
  for (;;) {
    try {
      const answer = await api('GET', '/api/session', { quietSession: true });
      if (answer.status !== 503 || !keepAsking) return answer;
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      if (!keepAsking) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, SESSION_RETRY_MS));
  }
}

async function boot() {
  startServiceChecks();
  const path = location.pathname;
  const matched = matchRoute(path);
  if (path.startsWith('/l/')) {
    await renderRoute();
    return;
  }
  const answer = await findSession(Boolean(matched) && !matched.route.public);
  if (answer?.ok) {
    session.me = answer.data.user;
    session.breakGlass = answer.data.break_glass;
    if (path === '/sign-in') {
      location.replace(homeOf(session.me.role));
      return;
    }
  } else if (matched && !matched.route.public) {
    location.replace(`/sign-in?next=${encodeURIComponent(path)}`);
    return;
  }
  if (!matched && !session.me) {
    root().replaceChildren(noticeSlot, h('main', { class: 'page page-not-found' }, notFoundContent()));
    return;
  }
  await renderRoute();
}

boot();
