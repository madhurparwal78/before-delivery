import { find } from './dom';
import { startChrome } from './chrome';
import { checkStorageHealth, wireHeader } from './ui';

async function start(): Promise<void> {
  wireHeader();
  startChrome();
  const route = document.body.dataset.route ?? '';
  const host = find<HTMLElement>(`[data-ui="${route}"]`);
  switch (route) {
    case 'home': {
      const { mountHome } = await import('./pages/home');
      await mountHome();
      break;
    }
    case 'part': {
      const { mountPart } = await import('./pages/part');
      if (host) await mountPart(host);
      break;
    }
    case 'compare': {
      const { mountCompare } = await import('./pages/compare');
      if (host) await mountCompare(host);
      break;
    }
    case 'tape': {
      const { mountTapePage } = await import('./pages/tape-page');
      const node = find<HTMLElement>('[data-ui="tape-page"]');
      if (node) await mountTapePage(node);
      break;
    }
    case 'room': {
      const { mountRoom } = await import('./pages/room');
      if (host) await mountRoom(host);
      break;
    }
    case 'dashboard': {
      const { mountDashboard } = await import('./pages/dashboard');
      if (host) await mountDashboard(host);
      break;
    }
    case 'publish': {
      const { mountPublish } = await import('./pages/publish');
      if (host) await mountPublish(host);
      break;
    }
    case 'signin':
    case 'signup': {
      const { mountAuth } = await import('./pages/auth');
      if (host) mountAuth(host, route);
      break;
    }
    default:
      break;
  }
  if (route !== 'part') void checkStorageHealth();
}

void start();
