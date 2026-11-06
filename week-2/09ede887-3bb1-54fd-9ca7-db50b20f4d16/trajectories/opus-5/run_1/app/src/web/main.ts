import { buildChrome } from './chrome.js';
import { el } from './dom.js';
import { start, type Page, type Route } from './router.js';
import { restoreSession, storedToken } from './session.js';
import { setBearer } from './api.js';
import { agendaPage } from './pages/agenda.js';
import { authPage } from './pages/auth.js';
import { homePage } from './pages/home.js';
import { myAgendaPage } from './pages/myAgenda.js';
import { notFoundPage } from './pages/notFound.js';
import { organiserPage } from './pages/organiser.js';
import { recordPage } from './pages/record.js';
import { sessionPage } from './pages/session.js';
import { speakersPage } from './pages/speakers.js';

function pageFor(route: Route): Page {
  const sessionMatch = /^\/sessions\/([^/]+)$/.exec(route.path);
  if (sessionMatch !== null) return sessionPage(decodeURIComponent(sessionMatch[1] as string));
  switch (route.path) {
    case '/':
      return homePage();
    case '/agenda':
      return agendaPage(route);
    case '/my-agenda':
      return myAgendaPage();
    case '/speakers':
      return speakersPage();
    case '/record':
      return recordPage();
    case '/organiser':
      return organiserPage();
    case '/signin':
      return authPage('signin');
    case '/signup':
      return authPage('signup');
    default:
      return notFoundPage();
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;
  setBearer(storedToken());
  const chrome = buildChrome();
  const outlet = el('div', { class: 'outlet' });
  root.replaceChildren(
    el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }),
    chrome.header,
    outlet,
    chrome.footer,
  );
  const trackChromeHeight = (): void => {
    document.documentElement.style.setProperty('--chrome-height', `${chrome.header.offsetHeight}px`);
  };
  trackChromeHeight();
  window.addEventListener('resize', trackChromeHeight);
  await restoreSession();
  start(outlet, pageFor);
  trackChromeHeight();
}

void boot();
