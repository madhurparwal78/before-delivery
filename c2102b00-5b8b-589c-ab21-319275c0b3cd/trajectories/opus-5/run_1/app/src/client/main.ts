import type { Club, Cycle, Me } from '../shared/types.ts';
import { request } from './api.ts';
import { copy } from './copy.ts';
import { clear, el } from './dom.ts';
import { LiveRegion } from './live.ts';
import { createBreakdownPage } from './pages/breakdown.ts';
import { createCoordinatorCyclePage } from './pages/coordinatorCycle.ts';
import { createCoordinatorCyclesPage, createCycleFormPage } from './pages/coordinator.ts';
import { createMemberCyclePage } from './pages/memberCycle.ts';
import {
  createCreditHistoryPage,
  createMemberHomePage,
  createNotFoundPage,
  createSignInPage,
} from './pages/simple.ts';
import { homeFor, knownPath, roleMaySee, type LiveName, type Page, type Shell } from './pages/page.ts';

const root = document.getElementById('app')!;
const banners = new Map<string, string>();

const noticesRegion = el('section', { class: 'notices', role: 'region', 'aria-label': 'Notices' });
const coordinatorUpdates = new LiveRegion('Coordinator updates');
const bagUpdates = new LiveRegion('Bag updates');

let currentPage: Page | null = null;
let club: Club | null = null;
let paymentsTimer: number | null = null;

function paintBanners(): void {
  clear(noticesRegion);
  for (const [, text] of banners) {
    noticesRegion.append(el('p', { class: 'banner', text }));
  }
}

function setBanner(key: string, text: string | null): void {
  if (text === null) {
    if (!banners.has(key)) return;
    banners.delete(key);
  } else {
    if (banners.get(key) === text) return;
    banners.set(key, text);
  }
  paintBanners();
}

function say(region: LiveName, text: string): void {
  if (region === 'coordinator') coordinatorUpdates.say(text);
  else bagUpdates.say(text);
}

function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render();
}

async function checkPayments(): Promise<void> {
  const reply = await request<{ payments: string }>('GET', '/api/payments/status');
  if (!reply.ok) return;
  setBanner('payments', reply.body.payments === 'paused' ? copy.paymentsPaused : null);
}

function stopPaymentsWatch(): void {
  if (paymentsTimer !== null) {
    window.clearInterval(paymentsTimer);
    paymentsTimer = null;
  }
}

function buildTopBar(me: Me, clubRecord: Club): HTMLElement {
  const signOut = el('button', { type: 'button', class: 'sign-out', text: 'Sign out' }) as HTMLButtonElement;
  signOut.addEventListener('click', () => void signOutNow());
  return el('div', { class: 'top-bar' }, [
    el('span', { class: 'club-name', text: clubRecord.name }),
    el('span', { class: 'person-name', text: me.name }),
    signOut,
  ]);
}

async function signOutNow(): Promise<void> {
  await request('DELETE', '/api/session').catch(() => null);
  currentPage?.destroy();
  currentPage = null;
  banners.clear();
  coordinatorUpdates.restore('');
  bagUpdates.restore('');
  stopPaymentsWatch();
  club = null;
  window.history.replaceState({}, '', '/');
  await render();
}

function shellFor(me: Me, clubRecord: Club): Shell {
  return {
    me,
    club: clubRecord,
    setBanner,
    navigate,
    checkPayments: () => void checkPayments(),
    say,
  };
}

async function pageForPath(shell: Shell, path: string): Promise<Page> {
  const role = shell.me.role;
  if (!knownPath(path)) return createNotFoundPage(shell);
  if (!roleMaySee(role, path)) {
    window.history.replaceState({}, '', homeFor(role));
    return pageForPath(shell, homeFor(role));
  }
  if (path === '/') return createMemberHomePage(shell);
  if (path === '/credit') return createCreditHistoryPage(shell);
  if (path.startsWith('/cycles/')) return createMemberCyclePage(shell, path.slice('/cycles/'.length));
  if (path === '/coordinator') return createCoordinatorCyclesPage(shell);
  if (path === '/coordinator/cycles/new') return createCycleFormPage(shell, null);
  if (path.startsWith('/coordinator/cycles/')) {
    const cycleId = path.slice('/coordinator/cycles/'.length);
    const reply = await request<Cycle>('GET', `/api/cycles/${cycleId}`);
    if (!reply.ok) return createNotFoundPage(shell);
    return reply.body.status === 'draft'
      ? createCycleFormPage(shell, reply.body)
      : createCoordinatorCyclePage(shell, cycleId);
  }
  return createBreakdownPage(shell);
}

async function render(): Promise<void> {
  const meReply = await request<Me>('GET', '/api/me');
  currentPage?.destroy();
  currentPage = null;
  clear(root);
  banners.clear();
  paintBanners();

  if (meReply.status !== 200) {
    stopPaymentsWatch();
    const page = createSignInPage((me) => void afterSignIn(me));
    currentPage = page;
    root.append(page.element);
    page.start();
    return;
  }
  const me = meReply.body;
  if (!club) {
    const clubReply = await request<Club>('GET', '/api/club');
    if (clubReply.ok) club = clubReply.body;
  }
  const clubRecord = club ?? { name: '', time_zone: 'UTC', distributor: '' };
  const shell = shellFor(me, clubRecord);
  const page = await pageForPath(shell, window.location.pathname);
  currentPage = page;
  root.append(buildTopBar(me, clubRecord), noticesRegion, page.element);
  if (me.role === 'coordinator') root.append(coordinatorUpdates.element, bagUpdates.element);
  else if (me.role === 'volunteer') root.append(bagUpdates.element);
  page.start();

  stopPaymentsWatch();
  if (me.role === 'member') {
    void checkPayments();
    paymentsTimer = window.setInterval(() => void checkPayments(), 10_000);
  }
}

async function afterSignIn(me: Me): Promise<void> {
  const path = window.location.pathname;
  if (!knownPath(path) || !roleMaySee(me.role, path)) {
    window.history.replaceState({}, '', homeFor(me.role));
  }
  await render();
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('/api/')) return;
  event.preventDefault();
  navigate(href);
});

window.addEventListener('popstate', () => void render());

void render();
