import { api, type SessionUser } from './api.js';
import { bannerHtml, renderTopBar, wireServicePolling, wireSignOut, type ShellState } from './shell.js';
import { renderRackPage, mountRackPage } from './pages/rack.js';
import { renderBoardPage, mountBoardPage } from './pages/board.js';
import { renderSignInPage, mountSignInPage } from './pages/sign-in.js';
import { renderAccountPage, mountAccountPage } from './pages/account.js';
import { renderTicketPage, mountTicketPage } from './pages/ticket.js';
import { renderYardPage, mountYardPage } from './pages/yard.js';
import { renderOwnerPage, mountOwnerPage } from './pages/owner.js';
import { renderNotFoundPage, mountNotFoundPage } from './pages/not-found.js';

const app = document.getElementById('app') as HTMLElement;

interface Page {
  render(state: ShellState): string;
  mount(): void;
  servicesPage: 'rack' | 'board' | 'account' | 'yard' | 'ticket' | 'owner';
}

async function loadState(): Promise<ShellState> {
  const [services, session] = await Promise.all([
    api.services().catch(() => ({ billing: 'down' as const, storage: 'down' as const })),
    api.session().then((r) => r.user).catch(() => null),
  ]);
  return { user: session as SessionUser | null, services };
}

function routeFor(path: string): Page {
  if (path === '/' || path.startsWith('/?')) return rackPage();
  if (path === '/sign-in') return signInPage();
  if (path === '/account') return accountPage();
  if (path === '/yard') return yardPage();
  if (path === '/owner') return ownerPage();
  const boardMatch = path.match(/^\/boards\/([^/?]+)$/);
  if (boardMatch) return boardPage(decodeURIComponent(boardMatch[1]));
  const ticketMatch = path.match(/^\/tickets\/([^/?]+)$/);
  if (ticketMatch) return ticketPage(decodeURIComponent(ticketMatch[1]));
  return notFoundPage();
}

function rackPage(): Page {
  return {
    servicesPage: 'rack',
    render: (state) => renderRackPage(state),
    mount: () => mountRackPage(),
  };
}
function signInPage(): Page {
  return {
    servicesPage: 'rack',
    render: (state) => renderSignInPage(state),
    mount: () => mountSignInPage(),
  };
}
function accountPage(): Page {
  return {
    servicesPage: 'account',
    render: (state) => renderAccountPage(state),
    mount: () => mountAccountPage(),
  };
}
function yardPage(): Page {
  return {
    servicesPage: 'yard',
    render: (state) => renderYardPage(state),
    mount: () => mountYardPage(),
  };
}
function ownerPage(): Page {
  return {
    servicesPage: 'owner',
    render: (state) => renderOwnerPage(state),
    mount: () => mountOwnerPage(),
  };
}
function boardPage(tag: string): Page {
  return {
    servicesPage: 'board',
    render: (state) => renderBoardPage(state, tag),
    mount: () => mountBoardPage(tag),
  };
}
function ticketPage(id: string): Page {
  return {
    servicesPage: 'ticket',
    render: (state) => renderTicketPage(state, id),
    mount: () => mountTicketPage(id),
  };
}
function notFoundPage(): Page {
  return {
    servicesPage: 'rack',
    render: (state) => renderNotFoundPage(state),
    mount: () => mountNotFoundPage(),
  };
}

async function navigate(): Promise<void> {
  const path = window.location.pathname + window.location.search;
  const state = await loadState();
  const page = routeFor(window.location.pathname);
  if (page.servicesPage === 'account' && state.user === null) {
    window.location.href = `/sign-in?next=${encodeURIComponent('/account')}`;
    return;
  }
  if (page.servicesPage === 'yard' && state.user === null) {
    window.location.href = `/sign-in?next=${encodeURIComponent('/yard')}`;
    return;
  }
  if (page.servicesPage === 'owner' && state.user === null) {
    window.location.href = `/sign-in?next=${encodeURIComponent('/owner')}`;
    return;
  }
  if (page.servicesPage === 'ticket' && state.user === null) {
    window.location.href = `/sign-in?next=${encodeURIComponent(path)}`;
    return;
  }
  app.innerHTML = `${renderTopBar(state)}${bannerHtml(state, page.servicesPage)}<main>${page.render(state)}</main>`;
  wireSignOut();
  // Pages read the service state at mount; later polls arrive as kerfwell-services events.
  (globalThis as unknown as { kerfwellServices: unknown }).kerfwellServices = state.services;
  page.mount();
  wireServicePolling(page.servicesPage, () => {
    void loadState().then((fresh) => {
      const notice = document.getElementById('service-notice');
      if (notice) notice.innerHTML = bannerHtml(fresh, page.servicesPage);
      document.dispatchEvent(new CustomEvent('kerfwell-services', { detail: fresh.services }));
    });
  });
}

window.addEventListener('popstate', () => void navigate());
document.addEventListener('kerfwell-navigate', () => void navigate());

void navigate();
