// Router: server-rendered shell, client-side navigation between the published routes.
import { hooks } from './hooks.js';
import { loadSession, session } from './session.js';
import { refreshBanner, renderTopbar } from './shell.js';

const ROUTES = [
  [/^\/$/, () => import('./pages/landing.js'), 'landing'],
  [/^\/(signin|signup)$/, () => import('./pages/auth.js'), 'auth'],
  [/^\/archive$/, () => import('./pages/archive.js')],
  [/^\/curves$/, () => import('./pages/curves.js')],
  [/^\/log$/, () => import('./pages/log.js')],
  [/^\/rolls\/new$/, () => import('./pages/roll_form.js')],
  [/^\/rolls\/([^/]+)\/edit$/, () => import('./pages/roll_form.js')],
  [/^\/rolls\/([^/]+)\/scans\/([^/]+)$/, () => import('./pages/workspace.js')],
  [/^\/rolls\/([^/]+)$/, () => import('./pages/roll.js')],
];
const OPEN_PAGES = new Set(['/', '/signin', '/signup']);

let cleanup = null;
let renderToken = 0;

export function navigate(url, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
  return render();
}

async function render() {
  const token = ++renderToken;
  cleanup?.();
  cleanup = null;
  const main = document.getElementById('main');
  main.replaceChildren();
  if (!session.loaded) {
    await loadSession();
    session.loaded = true;
  }
  const path = location.pathname;
  if (!session.account && !OPEN_PAGES.has(path)) {
    return navigate(`/signin?next=${encodeURIComponent(path + location.search)}`, { replace: true });
  }
  const match = ROUTES.map(([pattern, load, variant]) => [pattern.exec(path), load, variant]).find(([found]) => found);
  const variant = match?.[2] ?? 'app';
  renderTopbar(variant);
  const [page] = await Promise.all([
    (match ? match[1]() : import('./pages/not_found.js')),
    refreshBanner(),
  ]);
  if (token !== renderToken) return undefined;
  document.title = 'Edgeprint';
  window.scrollTo(0, 0);
  const result = await page.render(main, { params: match ? match[0].slice(1) : [], query: new URLSearchParams(location.search) });
  if (token !== renderToken) {
    result?.();
    return undefined;
  }
  cleanup = typeof result === 'function' ? result : null;
  if (document.activeElement === document.body || document.activeElement === main) {
    const heading = main.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
  }
  return undefined;
}

hooks.navigate = navigate;
hooks.unauthenticated = () => {
  session.account = null;
  navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
};
hooks.storageRefused = () => { refreshBanner(); };

document.addEventListener('click', (event) => {
  const anchor = event.target.closest?.('a[href]');
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (anchor.target || anchor.hasAttribute('download') || anchor.origin !== location.origin || anchor.pathname.startsWith('/api/')) return;
  event.preventDefault();
  navigate(anchor.pathname + anchor.search);
});
window.addEventListener('popstate', render);
render();
