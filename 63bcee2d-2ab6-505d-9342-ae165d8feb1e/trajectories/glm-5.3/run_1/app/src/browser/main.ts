// Browser entry: routing, headers, boot.

import { clear, h, initLiveRegions, reducedMotion } from './ui.js';
import { ApiError } from './api.js';
import {
  joinScreen,
  loadSession,
  membersScreen,
  officeHeader,
  rolloutsScreen,
  signInScreen,
  skipLink,
  STUDIO_ROLES,
  tenderSignInScreen,
} from './office.js';
import { projectScreen } from './project.js';
import { levellingScreen, tenderDetailScreen } from './tenders.js';
import { caseStudiesScreen, enquiriesScreen, previewScreen } from './casestudies.js';
import { caseStudyScreen, enquiryScreen, homeScreen, notFoundMain, publicHeader, workScreen } from './public.js';

const app = document.getElementById('app')!;

function nextParam(): string | null {
  return new URLSearchParams(window.location.search).get('next');
}

async function publicRoute(active: string, renderScreen: () => Promise<HTMLElement>): Promise<HTMLElement> {
  const screen = await renderScreen();
  return h('div', { class: 'screen screen-public' }, publicHeader(active), screen);
}

async function officeRoute(active: string, renderScreen: () => Promise<HTMLElement>): Promise<HTMLElement> {
  const member = await loadSession();
  if (!member) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.history.replaceState({}, '', `/sign-in?next=${next}`);
    return h('div', { class: 'screen' }, signInScreen(nextParam()));
  }
  const screen = await renderScreen();
  return h('div', { class: 'screen' }, officeHeader(active), screen);
}

const routes: { pattern: RegExp; render: () => Promise<HTMLElement> }[] = [
  { pattern: /^\/$/, render: () => publicRoute('home', homeScreen) },
  { pattern: /^\/work\/?$/, render: () => publicRoute('work', workScreen) },
  { pattern: /^\/work\/([a-z0-9][a-z0-9-]*)$/, render: () => publicRoute('work', async () => caseStudyScreen(slugOf())) },
  { pattern: /^\/start\/?$/, render: () => publicRoute('start', enquiryScreen) },
  { pattern: /^\/sign-in\/?$/, render: () => Promise.resolve(h('div', { class: 'screen' }, signInScreen(nextParam()))) },
  { pattern: /^\/office\/?$/, render: () => officeRoute('rollouts', rolloutsScreen) },
  { pattern: /^\/office\/members\/?$/, render: () => officeRoute('members', membersScreen) },
  { pattern: /^\/office\/case-studies\/?$/, render: () => officeRoute('case-studies', caseStudiesScreen) },
  { pattern: /^\/office\/enquiries\/?$/, render: () => officeRoute('enquiries', enquiriesScreen) },
  { pattern: /^\/office\/projects\/([0-9a-f-]{36})\/(stages|drawings|tenders|variations|certificates|shop-drawings|site-walk|finishes)$/, render: () => officeRoute('project', async () => projectScreen(idOf(), sectionOf())) },
  { pattern: /^\/office\/tenders\/([0-9a-f-]{36})\/levelling$/, render: () => officeRoute('tender', async () => levellingScreen(idOf())) },
  { pattern: /^\/office\/tenders\/([0-9a-f-]{36})$/, render: () => officeRoute('tender', async () => tenderDetailScreen(idOf())) },
  { pattern: /^\/preview\/([0-9A-Za-z_-]+)$/, render: () => publicRoute('preview', async () => previewScreen(tokenOf())) },
];

function pathSegment(index: number): string {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return parts[index] ?? '';
}

function slugOf(): string {
  return pathSegment(1);
}

function tokenOf(): string {
  return pathSegment(1);
}

function idOf(): string {
  return window.location.pathname.split('/').filter(Boolean)[2] ?? '';
}

function sectionOf(): string {
  return window.location.pathname.split('/').filter(Boolean)[3] ?? 'stages';
}

async function route(): Promise<void> {
  const path = window.location.pathname;
  clear(app);
  for (const entry of routes) {
    if (entry.pattern.test(path)) {
      let tree: HTMLElement;
      try {
        tree = await entry.render();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const next = encodeURIComponent(path + window.location.search);
          window.history.replaceState({}, '', `/sign-in?next=${next}`);
          tree = h('div', { class: 'screen' }, signInScreen(nextParam()));
        } else {
          tree = h('div', { class: 'screen screen-public' }, publicHeader(''), notFoundMain());
        }
      }
      app.append(skipLink(), tree);
      focusHeading();
      return;
    }
  }
  // Special token routes built with their real screens.
  const inviteMatch = path.match(/^\/invite\/([0-9A-Za-z_-]+)$/);
  if (inviteMatch) {
    app.append(skipLink(), h('div', { class: 'screen' }, await joinScreen(inviteMatch[1])));
    focusHeading();
    return;
  }
  const tenderSignIn = path.match(/^\/tender-sign-in\/([0-9A-Za-z_-]+)$/);
  if (tenderSignIn) {
    app.append(skipLink(), h('div', { class: 'screen' }, tenderSignInScreen(tenderSignIn[1])));
    focusHeading();
    return;
  }
  app.append(skipLink(), h('div', { class: 'screen screen-public' }, publicHeader(''), notFoundMain()));
  focusHeading();
}

function focusHeading(): void {
  const heading = app.querySelector<HTMLElement>('main h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

async function boot(): Promise<void> {
  initLiveRegions();
  await route();
  window.addEventListener('popstate', () => {
    void route();
  });
  window.addEventListener('focus', () => {
    if (document.body.classList.contains('has-open-dialog')) return;
    const path = window.location.pathname;
    if (path.startsWith('/office')) {
      void route();
    }
  });
  setInterval(() => {
    if (document.body.classList.contains('has-open-dialog')) return;
    const path = window.location.pathname;
    if (path.startsWith('/office/tenders') || path.includes('shop-drawings')) {
      void route();
    }
  }, 60_000);
  if (reducedMotion()) {
    document.body.setAttribute('data-reduced-motion', 'true');
  }
  void STUDIO_ROLES;
}

void boot();
