// Pegworth Desk browser entry: routes each screen, holds the app state and shared furniture.

import { App } from './app';
import { parseScreen, isProtectedPath, landingPath } from './router';
import { el, clear } from './dom';
import { renderTopBar, renderServiceBanner } from './ui';
import { renderPegboardScreen } from './pegboardScreen';
import { renderSignInScreen } from './signinScreen';
import { renderJoinScreen } from './joinScreen';
import { renderAccountScreen } from './accountScreen';
import { renderDeskScreen } from './deskScreen';
import { renderLoanScreen } from './loanScreen';
import { renderFeeScreen } from './feeScreen';
import { renderOfficeScreen } from './officeScreen';

export interface ScreenKit {
  app: App;
  root: HTMLElement;
  topbar: HTMLElement;
  banner: HTMLElement;
  main: HTMLElement;
  path: string;
}

export function renderNotFound(main: HTMLElement): void {
  clear(main);
  const wrap = el('div', { class: 'not-found' });
  wrap.append(
    el('h1', { text: "We couldn't find that page." }),
    el('p', {}, el('a', { href: '/', text: 'Back to the pegboard' })),
  );
  main.append(wrap);
}

const app = new App();
const root = document.getElementById('app')!;

let currentCleanup: (() => void) | null = null;

export function navigate(path: string): void {
  window.history.pushState({}, '', path);
  void render();
}

async function boot(): Promise<void> {
  await Promise.all([app.loadMe(), app.refreshBoard(), app.refreshStatus()]);

  const shell = el('div');
  const topbar = el('header', { class: 'topbar' });
  const banner = el('div', { class: 'service-banner' });
  const main = el('main');
  shell.append(topbar, banner, main);
  clear(root);
  root.append(shell);

  window.addEventListener('popstate', () => void render());
  app.subscribe(() => {
    renderTopBar(app, topbar, window.location.pathname);
    renderServiceBanner(banner, app.status);
  });

  await render();
}

async function render(): Promise<void> {
  const topbar = document.querySelector('.topbar') as HTMLElement;
  const banner = document.querySelector('.service-banner') as HTMLElement;
  const main = document.querySelector('main') as HTMLElement;
  const path = window.location.pathname;
  const search = window.location.search;

  if (currentCleanup !== null) {
    currentCleanup();
    currentCleanup = null;
  }
  clear(main);
  renderTopBar(app, topbar, path);
  renderServiceBanner(banner, app.status);

  const screen = parseScreen(path);
  const role = app.role();

  // Signed-in users opening /signin or /join go to their landing path.
  if ((screen.name === 'signin' || screen.name === 'join') && role !== null) {
    window.history.replaceState({}, '', landingPath(role));
    await render();
    return;
  }
  // A signed-out visitor opening a protected screen is sent to sign-in with next.
  if (role === null && isProtectedPath(path)) {
    window.history.replaceState({}, '', `/signin?next=${encodeURIComponent(path)}`);
    await render();
    return;
  }

  const kit: ScreenKit = { app, root, topbar, banner, main, path };

  switch (screen.name) {
    case 'pegboard':
      currentCleanup = renderPegboardScreen(kit);
      break;
    case 'signin':
      currentCleanup = renderSignInScreen(kit, search);
      break;
    case 'join':
      currentCleanup = renderJoinScreen(kit);
      break;
    case 'account':
      currentCleanup = renderAccountScreen(kit);
      break;
    case 'loan':
      currentCleanup = renderLoanScreen(kit, screen.id);
      break;
    case 'fee':
      currentCleanup = renderFeeScreen(kit, screen.id);
      break;
    case 'desk':
      currentCleanup = renderDeskScreen(kit);
      break;
    case 'office':
      currentCleanup = renderOfficeScreen(kit);
      break;
    case 'notfound':
      renderNotFound(main);
      break;
  }
}

void boot();
