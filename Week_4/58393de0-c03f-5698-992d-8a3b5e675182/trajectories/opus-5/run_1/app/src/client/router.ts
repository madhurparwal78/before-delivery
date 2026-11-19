import { clear } from './dom.js';
import { clearNotices } from './notice.js';

export type Page = (main: HTMLElement, url: URL) => Promise<void> | void;

interface Route {
  match: (pathname: string) => boolean;
  load: () => Promise<Page>;
}

const routes: Route[] = [
  { match: (path) => path === '/', load: async () => (await import('./pages/landing.js')).landingPage },
  { match: (path) => path === '/signup', load: async () => (await import('./pages/auth.js')).signupPage },
  { match: (path) => path === '/signin', load: async () => (await import('./pages/auth.js')).signinPage },
  { match: (path) => path === '/verify', load: async () => (await import('./pages/auth.js')).verifyPage },
  { match: (path) => path === '/join', load: async () => (await import('./pages/join.js')).joinPage },
  { match: (path) => path === '/dashboard', load: async () => (await import('./pages/dashboard.js')).dashboardPage },
  { match: (path) => path === '/class', load: async () => (await import('./pages/home.js')).studentHomePage },
  { match: (path) => path === '/projects', load: async () => (await import('./pages/home.js')).personalHomePage },
  {
    match: (path) => /^\/classrooms\/[^/]+$/.test(path),
    load: async () => (await import('./pages/classroom.js')).classroomPage,
  },
  { match: (path) => /^\/editor\/[^/]+$/.test(path), load: async () => (await import('./editors/editor.js')).editorPage },
];

let host: HTMLElement | null = null;
let onRender: (() => void) | null = null;
const leaveHandlers: (() => void)[] = [];

export const onLeave = (handler: () => void): void => {
  leaveHandlers.push(handler);
};

const notFoundPage: Page = (main) => {
  const heading = document.createElement('h1');
  heading.textContent = 'Not found.';
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = 'Quarkyard home';
  link.className = 'qy-pill qy-pill-solid';
  const section = document.createElement('section');
  section.className = 'qy-column qy-empty';
  section.append(heading, link);
  main.append(section);
};

const render = async (): Promise<void> => {
  if (!host) return;
  while (leaveHandlers.length > 0) leaveHandlers.pop()?.();
  clearNotices();
  clear(host);
  const url = new URL(window.location.href);
  const route = routes.find((candidate) => candidate.match(url.pathname));
  const page = route ? await route.load() : notFoundPage;
  onRender?.();
  await page(host, url);
};

export const navigate = (href: string): void => {
  if (href === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  const target = new URL(href, window.location.origin);
  if (target.pathname === window.location.pathname && target.hash !== '') {
    window.history.pushState({}, '', href);
    document.getElementById(target.hash.slice(1))?.scrollIntoView({ behavior: 'auto' });
    return;
  }
  window.history.pushState({}, '', href);
  void render();
};

export const reload = (): void => {
  void render();
};

export const startRouter = (main: HTMLElement, refreshHeader: () => void): void => {
  host = main;
  onRender = refreshHeader;
  window.addEventListener('popstate', () => {
    void render();
  });
  void render();
};
