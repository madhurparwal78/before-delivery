import { ApiError, call, currentAccount, dropSession, onOutage, resumeSession, signIn, signOut } from './api';
import { announce, clear, clearLive, el, refuse } from './ui';
import { go, homeOf, replace, resumeAllowed, setPainter } from './navigate';
import { renderBoat, renderDrawStep, renderLoft, renderMeasureStep, stepRail } from './loft';
import { renderConfirmStep, renderOverview, stopDrawingPoll } from './drawing';
import {
  renderAccounts, renderConsole, renderFloor, renderLedger, renderOwner, renderRuleSets,
  renderSheetViewer, renderStock,
} from './records';
import { NestingScreen, type Drawing } from './nesting';
import { ERROR_COPY, NOT_FOUND_HEADING, OUTAGE_COPY, stepCopy, SUCCESS } from '../src/shared/copy';

/** The router. Every screen comes from server state, and a reload resumes it. */

const NAV: Record<string, readonly [string, string][]> = {
  sailmaker: [
    ['/loft', 'Loft'],
    ['/stock', 'Stock'],
    ['/ledger', 'Ledger'],
    ['/console', 'Console'],
    ['/rulesets', 'Rule sets'],
    ['/accounts', 'Accounts'],
  ],
  'loft-hand': [['/floor', 'Cutting floor']],
  'yacht-owner': [
    ['/owner', 'My boats'],
    ['/owner', 'Cut sheets'],
  ],
};

let nesting: NestingScreen | null = null;
let stopViewer: (() => void) | null = null;
let floorPoll: number | null = null;
let seenQueue = new Set<string>();

function teardown(): void {
  nesting?.stop();
  nesting = null;
  stopViewer?.();
  stopViewer = null;
  stopDrawingPoll();
  if (floorPoll !== null) window.clearInterval(floorPoll);
  floorPoll = null;
}

function chrome(app: HTMLElement): HTMLElement {
  const account = currentAccount();
  clear(app);
  if (account === null) return app;
  const nav = el('nav', { class: 'loft-nav', 'aria-label': 'Loft' });
  for (const [href, label] of NAV[account.role] ?? []) {
    const link = el('a', { href, text: label });
    if (location.pathname === href) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  const out = el('button', { type: 'button', text: 'Sign out' });
  out.addEventListener('click', () => {
    void (async () => {
      await signOut();
      // Every record the browser holds goes before the next screen paints.
      teardown();
      seenQueue = new Set();
      clearLive();
      location.assign('/');
    })();
  });
  nav.append(out);
  app.append(nav);
  const sheet = el('div', { class: 'sheet' });
  app.append(sheet);
  return sheet;
}

function notFoundScreen(app: HTMLElement): void {
  clear(app);
  app.append(el('div', { class: 'notfound' }, [el('h1', { text: NOT_FOUND_HEADING, tabindex: '-1' })]));
}

function focusHeading(scope: ParentNode): void {
  const heading = scope.querySelector<HTMLElement>('h1[tabindex="-1"]');
  heading?.focus();
}

const ROLE_OF_ROUTE: Record<string, string> = {
  '/loft': 'sailmaker',
  '/boats': 'any',
  '/drawings': 'sailmaker',
  '/floor': 'loft-hand',
  '/stock': 'sailmaker',
  '/ledger': 'sailmaker',
  '/console': 'sailmaker',
  '/rulesets': 'sailmaker',
  '/accounts': 'sailmaker',
  '/owner': 'yacht-owner',
  '/sheets': 'yacht-owner',
};

function allowed(pathname: string, role: string): boolean {
  const head = `/${pathname.split('/')[1] ?? ''}`;
  const wanted = ROLE_OF_ROUTE[head];
  if (wanted === undefined) return false;
  return wanted === 'any' || wanted === role;
}

async function paintApp(app: HTMLElement, pathname: string, query: URLSearchParams): Promise<void> {
  const account = currentAccount();
  if (account === null) {
    const resume = encodeURIComponent(pathname + (query.toString() === '' ? '' : `?${query.toString()}`));
    location.assign(`/signin?resume=${resume}`);
    return;
  }
  if (!allowed(pathname, account.role)) {
    notFoundScreen(app);
    return;
  }

  const sheet = chrome(app);
  const parts = pathname.split('/').filter((part) => part !== '');
  const head = parts[0] as string;

  try {
    if (head === 'loft') await renderLoft(sheet, query);
    else if (head === 'boats' && parts[1]) await renderBoat(sheet, parts[1]);
    else if (head === 'stock') await renderStock(sheet);
    else if (head === 'ledger') await renderLedger(sheet, query);
    else if (head === 'console') await renderConsole(sheet, query);
    else if (head === 'rulesets') await renderRuleSets(sheet);
    else if (head === 'accounts') await renderAccounts(sheet);
    else if (head === 'owner') await renderOwner(sheet);
    else if (head === 'sheets' && parts[1]) stopViewer = await renderSheetViewer(sheet, parts[1]);
    else if (head === 'floor' && parts[1] === undefined) await paintFloor(sheet);
    else if (head === 'floor' && parts[1]) await paintNesting(sheet, parts[1]);
    else if (head === 'drawings' && parts[1] && parts[2] === undefined) await renderOverview(sheet, parts[1]);
    else if (head === 'drawings' && parts[1] && parts[2]) await paintStep(sheet, parts[1], parts[2]);
    else {
      notFoundScreen(app);
      return;
    }
    focusHeading(sheet);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404) {
      notFoundScreen(app);
      return;
    }
    if (cause instanceof ApiError && cause.code === 'database_unavailable') {
      sheet.append(el('p', { class: 'errorfield', text: OUTAGE_COPY.database }));
      return;
    }
    if (cause instanceof ApiError) refuse(cause.message);
  }
}

async function paintFloor(sheet: HTMLElement): Promise<void> {
  await renderFloor(sheet);
  // The cutting floor fetches the loft hand's drawings at least every 5 seconds.
  floorPoll = window.setInterval(() => {
    void (async () => {
      const page = await call<{ items: readonly Drawing[] }>('/api/drawings?limit=50');
      const fresh = page.items.filter((item) => !seenQueue.has(item.code));
      if (seenQueue.size === 0) {
        for (const item of page.items) seenQueue.add(item.code);
        return;
      }
      if (fresh.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      for (const item of fresh) seenQueue.add(item.code);
      await renderFloor(sheet);
      announce(SUCCESS.queueAssignment((fresh[0] as Drawing).code));
      active?.focus();
    })();
  }, 5000);
}

async function paintNesting(sheet: HTMLElement, code: string): Promise<void> {
  nesting = new NestingScreen(sheet, code, false);
  await nesting.start();
  window.addEventListener('boltrope:cut-finished', () => go('/floor'), { once: true });
}

const STEP_LABELS: Record<string, 'Measure' | 'Draw' | 'Nest'> = {
  measure: 'Measure',
  draw: 'Draw',
  nest: 'Nest',
};

async function paintStep(sheet: HTMLElement, code: string, step: string): Promise<void> {
  const drawing = await call<Drawing>(`/api/drawings/${code}`);
  const order = ['measure', 'draw', 'nest', 'confirm'];
  const wantedIndex = order.indexOf(step);
  if (wantedIndex === -1) throw new ApiError(404, { error: 'not_found', message: ERROR_COPY.not_found });
  const firstUnmet = order.indexOf(drawing.step);
  // Opening an unreachable step lands on the first unmet step.
  if (wantedIndex > firstUnmet) {
    replace(`/drawings/${code}/${drawing.step}`);
    const label = STEP_LABELS[drawing.step];
    if (label !== undefined) refuse(stepCopy(label));
    return;
  }
  if (step === 'measure') await renderMeasureStep(sheet, code);
  else if (step === 'draw') await renderDrawStep(sheet, code);
  else if (step === 'nest') {
    clear(sheet);
    sheet.append(stepRail(drawing, 'nest'));
    const body = el('div', { class: 'sheet step' });
    sheet.append(body);
    nesting = new NestingScreen(body, code, true);
    await nesting.start();
    window.addEventListener('boltrope:cut-finished', () => go(`/drawings/${code}`), { once: true });
  } else await renderConfirmStep(sheet, code);
}

/* ------------------------------------------------------------------ boot */

function bindSignIn(): void {
  const form = document.getElementById('signin-form') as HTMLFormElement | null;
  if (form === null) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = (document.getElementById('signin-email') as HTMLInputElement).value;
    const password = (document.getElementById('signin-password') as HTMLInputElement).value;
    void (async () => {
      try {
        const account = await signIn(email, password);
        const resume = resumeAllowed(new URLSearchParams(location.search).get('resume'));
        location.assign(resume !== null && allowed(resume, account.role) ? resume : homeOf(account.role));
      } catch (cause) {
        if (cause instanceof ApiError) refuse(cause.message);
      }
    })();
  });
}

function bindLinks(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest('a');
    if (target === null) return;
    const href = target.getAttribute('href');
    if (href === null || href.startsWith('/api/') || target.hasAttribute('download')) return;
    if (!href.startsWith('/')) return;
    event.preventDefault();
    go(href);
  });
}

function showOutage(copy: string | null): void {
  const existing = document.querySelector('[data-store-outage]');
  existing?.remove();
  if (copy === null) return;
  const banner = el('p', {
    class: 'outage',
    role: 'region',
    'aria-label': 'Store outage',
    'data-store-outage': '',
    text: copy,
  });
  document.body.prepend(banner);
}

async function boot(): Promise<void> {
  const page = document.documentElement.dataset['page'];
  if (page === 'signin') {
    bindSignIn();
    return;
  }
  if (page !== 'app') return;

  const app = document.getElementById('app') as HTMLElement;
  bindLinks(app);
  onOutage(showOutage);
  setPainter((path) => {
    teardown();
    clearLive();
    const url = new URL(path, location.origin);
    void paintApp(app, url.pathname, url.searchParams);
  });
  window.addEventListener('popstate', () => {
    teardown();
    void paintApp(app, location.pathname, new URLSearchParams(location.search));
  });

  const account = currentAccount() ?? (await resumeSession());
  if (account === null) {
    dropSession();
    const resume = encodeURIComponent(location.pathname + location.search);
    location.assign(`/signin?resume=${resume}`);
    return;
  }
  await paintApp(app, location.pathname, new URLSearchParams(location.search));
}

void boot();
