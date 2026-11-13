import { clear, el } from './dom.js';
import { render, route, startRouter } from './router.js';
import { loadConfig, refreshMe, startHealthLoop } from './store.js';
import { renderHome } from './screens/home.js';
import { renderWelcome } from './screens/welcome.js';
import { renderLocal, startPendingLoop } from './screens/local.js';
import { renderMatch } from './screens/match.js';
import { renderRoom } from './screens/room.js';
import { renderJoinCode, renderJoinLink } from './screens/join.js';
import { renderQueue } from './screens/queue.js';
import { renderProfile } from './screens/profile.js';
import { renderShop } from './screens/shop.js';
import { renderLeaderboard } from './screens/leaderboard.js';
import { topbar } from './screens/shell.js';

interface Boot {
  link?: 'expired';
}

function boot(): Boot {
  const node = document.getElementById('boot');
  if (node === null) return {};
  try {
    return JSON.parse(node.textContent ?? '{}') as Boot;
  } catch {
    return {};
  }
}

function shell(): HTMLElement {
  const app = document.getElementById('app');
  if (app === null) throw new Error('missing app root');
  clear(app);
  const banner = el('div', { id: 'outage-banner', role: 'status' });
  const status = el('div', { id: 'page-status', role: 'status' });
  const view = el('main', { id: 'view' });
  app.append(banner, status, view);
  return view;
}

function expiredPage(view: HTMLElement): void {
  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: 'This link has expired', style: 'font-size: var(--step-3)' }),
        el('p', {}, [el('a', { href: '/', text: 'Home' })]),
      ]),
    ]),
  );
}

async function start(): Promise<void> {
  const view = shell();
  await loadConfig();
  await refreshMe();
  startHealthLoop();
  startPendingLoop();

  if (boot().link === 'expired') {
    expiredPage(view);
    window.addEventListener('popstate', () => void render());
    document.addEventListener('click', (event) => {
      const anchor = (event.target as Element | null)?.closest('a');
      if (anchor === null || anchor === undefined) return;
      const href = anchor.getAttribute('href');
      if (href === null || !href.startsWith('/')) return;
      event.preventDefault();
      window.history.pushState({}, '', href);
      void render();
    });
    registerRoutes();
    return;
  }

  registerRoutes();
  startRouter();
}

function registerRoutes(): void {
  route('/', renderHome);
  route('/welcome', renderWelcome);
  route('/play/local', renderLocal);
  route('/match/:id', renderMatch);
  route('/room/:code', renderRoom);
  route('/join', renderJoinCode);
  route('/join/:code', renderJoinLink);
  route('/queue/:mode', renderQueue);
  route('/profile/:name', renderProfile);
  route('/shop', renderShop);
  route('/leaderboard', renderLeaderboard);
}

void start();
