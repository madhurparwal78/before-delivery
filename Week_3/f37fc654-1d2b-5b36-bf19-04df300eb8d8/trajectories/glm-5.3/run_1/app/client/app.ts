/** App shell: top bar, stage, live regions, and route dispatch. */
import { el, toast } from './dom.js';
import { api } from './api.js';
import type { Me, ServiceStatus } from './types.js';
import { OUTAGE_BANNERS } from './types.js';
import { VenueStage } from './stage.js';
import { renderRoute } from './screens/router.js';
import './screens/index.js';

export interface App {
  stage: VenueStage;
  me: Me | null;
  services: ServiceStatus | null;
  main: HTMLElement;
  statusRegions: {
    upload: HTMLElement;
    preview: HTMLElement;
    quote: HTMLElement;
    placement: HTMLElement;
    hold: HTMLElement;
    payment: HTMLElement;
    board: HTMLElement;
    brief: HTMLElement;
    session: HTMLElement;
    notices: HTMLElement;
  };
  setScene(scene: 'landing' | 'brief' | 'configurator' | 'working'): void;
  toast(text: string): void;
}

let app: App | null = null;

export function getApp(): App {
  if (!app) throw new Error('app not ready');
  return app;
}

export function tryGetApp(): App | null {
  return app;
}

export async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  root.textContent = '';

  const canvas = el('canvas', { id: 'stage', class: 'stage-canvas', role: 'img', alt: 'Venue stage', 'aria-hidden': 'false' }) as HTMLCanvasElement;
  const noticesWrap = el('div', { class: 'notices-wrap' });
  const serviceNotices = el('div', { id: 'service-notices', role: 'status', 'aria-live': 'polite', class: 'service-notices' });
  const notices = el('div', { id: 'notices', role: 'status', 'aria-live': 'polite', class: 'toasts' });
  noticesWrap.append(serviceNotices, notices);

  const topBar = el('header', { class: 'topbar' });
  const session = el('div', { id: 'session', role: 'status', 'aria-live': 'polite', class: 'session-region' });

  const main = el('main', { id: 'main', class: 'column' });

  const liveWrap = el('div', { class: 'live-regions', 'aria-hidden': 'true' });
  const brief = el('div', { id: 'brief-progress', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  const upload = el('div', { id: 'upload-status', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  const preview = el('div', { id: 'preview-status', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  const quote = el('div', { id: 'quote-total', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  const placement = el('div', { id: 'placement-status', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  const hold = el('div', { id: 'hold-status', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  const payment = el('div', { id: 'payment-status', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  const board = el('div', { id: 'board-updates', role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  liveWrap.append(brief, upload, preview, quote, placement, hold, payment, board);

  root.append(canvas, noticesWrap, topBar, main, liveWrap, session);

  const stage = new VenueStage(canvas);

  let me: Me | null = null;
  try {
    me = await api<Me>('/me');
  } catch {
    me = null;
  }

  app = {
    stage,
    me,
    services: null,
    main,
    statusRegions: {
      upload,
      preview,
      quote,
      placement,
      hold,
      payment,
      board,
      brief,
      session,
      notices,
    },
    setScene(scene) {
      stage.setScene(scene);
    },
    toast,
  };

  renderTopBar(topBar, me);
  void pollServices();
  window.addEventListener('popstate', () => {
    void navigate(location.pathname + location.search);
  });
  window.addEventListener('spindrift:signedout', () => {
    setStatus(session, 'Your session ended. Sign in again — what you entered is kept.');
  });
  await navigate(location.pathname + location.search);
}

export function setStatus(node: HTMLElement, message: string): void {
  node.textContent = message;
}

export async function navigate(url: string): Promise<void> {
  const [path, query] = url.split('?');
  const params = new URLSearchParams(query ?? '');
  await renderRoute(path ?? '/', params);
}

export function goto(url: string): void {
  history.pushState({}, '', url);
  void navigate(url);
}

function renderTopBar(topBar: HTMLElement, me: Me | null): void {
  topBar.textContent = '';
  const wordmark = el('a', { href: '/', class: 'wordmark' }, 'Spindrift Rooms');
  wordmark.addEventListener('click', (e) => {
    e.preventDefault();
    goto('/');
  });
  const nav = el('nav', { class: 'topbar-nav', 'aria-label': 'Primary' });
  const role = me?.roles[0];
  if (me) {
    if (role === 'client') {
      nav.append(link('Commissions', '/commissions'), link('CRM settings', '/settings/crm'));
    } else if (role === 'producer') {
      nav.append(link('Studio', '/studio'), link('Jobs', '/studio/jobs'));
    } else if (role === 'crew') {
      nav.append(link('Install days', '/crew'));
    }
    const signOut = el('button', { class: 'btn ghost' }, 'Sign out');
    signOut.addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      location.href = '/';
    });
    nav.append(signOut);
  } else {
    nav.append(signInLink());
  }
  topBar.append(wordmark, nav);
  // Below 768 px the links move into the navigation drawer.
  const menuButton = el('button', { class: 'btn ghost menu-button', 'aria-haspopup': 'dialog' }, 'Menu');
  menuButton.addEventListener('click', () => {
    openDrawer(nav);
  });
  topBar.append(menuButton);
  applyResponsive();
}

function link(label: string, href: string): HTMLAnchorElement {
  const a = el('a', { href, class: 'topbar-link' }, label);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    goto(href);
  });
  return a;
}

function signInLink(): HTMLAnchorElement {
  const a = el('a', { href: '/auth/login', class: 'topbar-link' }, 'Sign in');
  return a;
}

function openDrawer(nav: HTMLElement): void {
  const backdrop = el('div', { class: 'dialog-backdrop drawer-backdrop' });
  const drawer = el('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Navigation' });
  const close = el('button', { class: 'btn ghost' }, 'Close menu');
  const list = el('div', { class: 'drawer-links' });
  const clone = nav.cloneNode(true) as HTMLElement;
  clone.classList.add('drawer-nav');
  clone.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const href = a.getAttribute('href') ?? '/';
      closeDrawer();
      goto(href);
    });
  });
  list.append(clone);
  drawer.append(close, list);
  backdrop.append(drawer);
  document.body.append(backdrop);
  close.focus();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeDrawer();
  };
  document.addEventListener('keydown', onKey);
  const closeDrawer = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    document.querySelector<HTMLButtonElement>('.menu-button')?.focus();
  };
  close.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeDrawer();
  });
}

function applyResponsive(): void {
  const update = (): void => {
    const narrow = window.innerWidth < 768;
    document.body.classList.toggle('narrow', narrow);
  };
  update();
  window.addEventListener('resize', update);
}

async function pollServices(): Promise<void> {
  const renderBanners = (services: ServiceStatus | null): void => {
    const region = document.getElementById('service-notices');
    if (!region) return;
    region.textContent = '';
    if (!services) return;
    for (const [key, status] of Object.entries(services)) {
      if (status !== 'down') continue;
      const text = OUTAGE_BANNERS[key];
      if (!text) continue;
      region.append(el('div', { class: 'banner' }, text));
    }
  };
  const poll = async (): Promise<void> => {
    try {
      const value = await api<{ services: ServiceStatus }>('/status');
      if (app) app.services = value.services;
      renderBanners(value.services);
    } catch {
      renderBanners(null);
    }
  };
  await poll();
  setInterval(() => {
    void poll();
  }, 10_000);
}
