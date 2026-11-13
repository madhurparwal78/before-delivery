import { App, loadChoices, loadCustomText, loadSettings, saveChoices as persistChoices, shell, renderTopRow } from './app.js';
import { api, ApiRequestError } from './api.js';
import { el } from './dom.js';
import { COPY } from './copy.js';
import { TestSheet } from './sheet.js';

// The single-page router and the screens.

export interface PageContext {
  app: App;
  main: HTMLElement;
  topRow: HTMLElement;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

let sheet: TestSheet | null = null;

export async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) return;
  const app = new App(root);
  await app.loadConfig();
  if (app.state.session !== null) await app.refreshSession();
  await app.loadSettings();

  const page = el('div', { class: 'page' }, '');
  const top = el('div', { class: 'page-top' }, '');
  const main = el('main', { class: 'page-main', id: 'main' }, '');
  const footerHost = el('div', { class: 'page-footer-host' }, '');
  root.append(page);
  page.append(top, main, footerHost);

  const navigate = (path: string, push = true): void => {
    if (push && path !== window.location.pathname) window.history.pushState({}, '', path);
    render();
  };

  const context: PageContext = {
    app,
    main,
    topRow: top,
    onNavigate: (path) => navigate(path),
    onSignOut: async () => {
      await app.signOut();
      renderTopRow(app, top, () => context.onSignOut());
      navigate('/signin');
    },
  };

  window.addEventListener('popstate', () => render());

  // A request that answers 401 for a page that showed a signed-in typist
  // replaces the top row's Account and Sign out with Sign in.
  const watchSession = setInterval(() => {
    if (app.state.session === null) return;
    void api<unknown>('/api/me', 'GET').catch((error) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        app.signOutLocally();
        renderTopRow(app, top, () => context.onSignOut());
      }
    });
  }, 4000);
  watchSession.unref?.();

  const render = (): void => {
    sheet?.abandon();
    sheet = null;
    app.disconnectLive();
    const path = window.location.pathname;
    main.textContent = '';
    const shellParts = shell(app, { current: currentOf(path), onNavigate: (p) => navigate(p), onSignOut: context.onSignOut });
    top.textContent = '';
    top.appendChild(shellParts.topRow);
    main.append(shellParts.nav);
    const folder = el('div', { class: `folder folder-${shellParts.nav.getAttribute('data-folder') ?? 'test'}` }, '');
    main.appendChild(folder);
    footerHost.textContent = '';
    footerHost.appendChild(shellParts.footer);

    if (path === '/' || path === '') {
      folder.classList.add('folder-test');
      const choices = loadChoices();
      const customText = loadCustomText();
      const hero = buildHero();
      folder.appendChild(hero);
      const sheetHost = hero.querySelector('.open-folder-body') as HTMLElement;
      sheet = new TestSheet(app, sheetHost, choices, persistChoices, customText, {
        onNavigate: (p) => navigate(p),
      });
      hero.querySelector('.begin-row')?.classList.add('sheet-begin-row');
    } else if (path === '/history') {
      void renderHistory(context, folder);
    } else if (path === '/boards') {
      void renderBoards(context, folder);
    } else if (path === '/race') {
      void renderRaceIndex(context, folder);
    } else if (path.startsWith('/race/')) {
      void renderRaceRoom(context, folder, path.slice('/race/'.length));
    } else if (path === '/settings') {
      renderSettings(context, folder);
    } else if (path === '/account') {
      void renderAccount(context, folder);
    } else if (path === '/signup') {
      renderAuthForm(context, folder, 'signup');
    } else if (path === '/signin') {
      renderAuthForm(context, folder, 'signin');
    } else if (path === '/reset') {
      renderAuthForm(context, folder, 'reset');
    } else if (path.startsWith('/reset/')) {
      renderAuthForm(context, folder, 'reset-confirm', path.slice('/reset/'.length));
    } else if (path.startsWith('/verify/')) {
      void renderVerify(context, folder, path.slice('/verify/'.length));
    } else if (path.startsWith('/runs/')) {
      void renderRun(context, folder, path.slice('/runs/'.length));
    } else {
      renderNotFound(folder);
    }
    window.scrollTo(0, 0);
  };

  render();
}

function currentOf(path: string): 'test' | 'history' | 'boards' | 'race' | 'settings' | 'other' {
  if (path === '/' || path === '') return 'test';
  if (path === '/history') return 'history';
  if (path === '/boards') return 'boards';
  if (path === '/race' || path.startsWith('/race/')) return 'race';
  if (path === '/settings') return 'settings';
  return 'other';
}

// The landing hero with the stacked folders.

function buildHero(): HTMLElement {
  const hero = el('section', { class: 'hero' }, '');
  const headline = el('h1', { class: 'headline' }, COPY.headline);
  const subline = el('p', { class: 'subline' }, COPY.subline);
  const stack = el('div', { class: 'folder-stack' }, '');
  const folders: { label: string; href: string; tone: string; open: boolean }[] = [
    { label: 'Test', href: '/', tone: 'sand', open: true },
    { label: 'History', href: '/history', tone: 'darker', open: false },
    { label: 'Boards', href: '/boards', tone: 'muted', open: false },
    { label: 'Race rooms', href: '/race', tone: 'sand', open: false },
    { label: 'Settings', href: '/settings', tone: 'darker', open: false },
  ];
  const openFolder = el('div', { class: 'folder open-folder' }, '');
  const openTab = el('div', { class: 'folder-tab-label' }, 'Test');
  const openBody = el('div', { class: 'open-folder-body' }, '');
  openFolder.append(openTab, openBody);

  for (const folder of folders.slice(1).reverse()) {
    const link = el('a', { href: folder.href, class: `stacked-folder tone-${folder.tone}` }, folder.label);
    const tab = el('span', { class: 'stacked-tab' }, folder.label);
    link.textContent = '';
    link.appendChild(tab);
    stack.appendChild(link);
  }
  hero.append(headline, subline, stack, openFolder);
  return hero;
}

function renderNotFound(folder: HTMLElement): void {
  const sheetEl = el('div', { class: 'sheet not-found-sheet' }, '');
  sheetEl.appendChild(el('h2', { class: 'sheet-heading' }, COPY.notFound));
  folder.appendChild(sheetEl);
}

async function renderVerify(context: PageContext, folder: HTMLElement, token: string): Promise<void> {
  const sheetEl = el('div', { class: 'sheet' }, '');
  const heading = el('h2', { class: 'sheet-heading' }, '');
  const line = el('p', { class: 'sheet-line' }, '');
  sheetEl.append(heading, line);
  folder.appendChild(sheetEl);
  try {
    await api('/api/verify', 'POST', { token });
    heading.textContent = COPY.verifiedHeading;
    line.textContent = COPY.verifiedLine;
  } catch (error) {
    heading.textContent = COPY.linkExpiredHeading;
    line.textContent = COPY.linkExpiredLine;
    void error;
  }
}

import { renderHistory } from './history.js';
import { renderBoards } from './boards.js';
import { renderRaceIndex, renderRaceRoom } from './race.js';
import { renderSettings } from './settings.js';
import { renderAccount } from './account.js';
import { renderAuthForm } from './auth.js';
import { renderRun } from './run.js';
export { renderHistory, renderBoards, renderRaceIndex, renderRaceRoom, renderSettings, renderAccount, renderAuthForm, renderRun };

// Entry point.
void boot();
