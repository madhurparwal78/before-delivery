import { CURS, Cur, LANGS, Lang } from '../shared/types';
import { api, failureOf } from './api';
import { clear, el } from './dom';
import { m, t } from './i18n';
import { setServerNow, state } from './state';

export interface Route {
  path: string;
  query: URLSearchParams;
  href: string;
}

export interface Regions {
  search: HTMLElement;
  hold: HTMLElement;
  dateHelp: HTMLElement;
  linkNotice: HTMLElement;
  roomAdvice: HTMLElement;
  toast: HTMLElement;
  outage: HTMLElement;
}

export const frame: {
  main: HTMLElement;
  header: HTMLElement;
  regions: Regions;
} = {
  main: document.createElement('main'),
  header: document.createElement('header'),
  regions: {
    search: document.createElement('div'),
    hold: document.createElement('div'),
    dateHelp: document.createElement('div'),
    linkNotice: document.createElement('div'),
    roomAdvice: document.createElement('div'),
    toast: document.createElement('div'),
    outage: document.createElement('div'),
  },
};

type Handler = (data: Record<string, unknown>) => void;
const listeners = new Map<string, Set<Handler>>();
let cleanups: (() => void)[] = [];

export function onEvent(name: string, handler: Handler): void {
  const set = listeners.get(name) ?? new Set<Handler>();
  set.add(handler);
  listeners.set(name, set);
  cleanups.push(() => set.delete(handler));
}

export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}

function emit(name: string, data: Record<string, unknown>): void {
  for (const handler of listeners.get(name) ?? []) handler(data);
}

export function toast(text: string): void {
  frame.regions.toast.textContent = text;
  window.setTimeout(() => {
    if (frame.regions.toast.textContent === text) frame.regions.toast.textContent = '';
  }, state.settings.toastMs);
}

export function outage(text: string | null): void {
  frame.regions.outage.textContent = text ?? '';
  frame.regions.outage.hidden = text === null;
}

export function routeOf(href: string): Route {
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams, href: url.pathname + url.search };
}

export function currentRoute(): Route {
  return routeOf(location.href);
}

export interface HistoryEntryState {
  scrollY: number;
  focusKey: string | null;
}

function captureEntry(): void {
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.getAttribute('data-focus-key') ?? null;
  const entry: HistoryEntryState = { scrollY: window.scrollY, focusKey };
  history.replaceState(entry, '', location.href);
}

export function navigate(href: string, mode: 'push' | 'replace' | 'none' = 'push'): Promise<void> {
  if (mode === 'push') {
    captureEntry();
    history.pushState({ scrollY: 0, focusKey: null } satisfies HistoryEntryState, '', href);
  } else if (mode === 'replace') {
    history.replaceState(history.state ?? { scrollY: 0, focusKey: null }, '', href);
  }
  return render();
}

export type Page = (main: HTMLElement, route: Route) => void | Promise<void>;
const pages: { pattern: RegExp; page: Page }[] = [];

export function registerPage(pattern: RegExp, page: Page): void {
  pages.push({ pattern, page });
}

let notFoundPage: Page = () => undefined;

export function registerNotFound(page: Page): void {
  notFoundPage = page;
}

export async function render(restore?: HistoryEntryState): Promise<void> {
  for (const fn of cleanups) fn();
  cleanups = [];
  const route = currentRoute();
  applyUrlPreferences(route);
  relabelRegions();
  clear(frame.main);
  frame.regions.linkNotice.textContent = '';
  frame.regions.roomAdvice.textContent = '';
  renderHeader();
  const match = pages.find((entry) => entry.pattern.test(route.path));
  const page = match ? match.page : notFoundPage;
  await page(frame.main, route);
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  if (restore) {
    const target = restore.focusKey
      ? document.querySelector<HTMLElement>(`[data-focus-key="${restore.focusKey}"]`)
      : null;
    window.scrollTo({ top: restore.scrollY });
    if (target) target.focus();
    else document.querySelector<HTMLElement>('[data-results-heading]')?.focus();
  }
}

function applyUrlPreferences(route: Route): void {
  const urlLang = route.query.get('lang');
  const urlCur = route.query.get('cur');
  if (urlLang && LANGS.includes(urlLang as Lang)) state.lang = urlLang as Lang;
  if (urlCur && CURS.includes(urlCur as Cur)) state.cur = urlCur as Cur;
}

/** Re-renders the page in place, keeping scroll and focus. */
export async function rerenderInPlace(): Promise<void> {
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.getAttribute('data-focus-key') ?? null;
  const scrollY = window.scrollY;
  await render();
  window.scrollTo({ top: scrollY });
  if (focusKey) document.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
}

export async function changePreference(change: { lang?: Lang; cur?: Cur }): Promise<void> {
  if (change.lang) state.lang = change.lang;
  if (change.cur) state.cur = change.cur;
  const url = new URL(location.href);
  url.searchParams.set('lang', state.lang);
  url.searchParams.set('cur', state.cur);
  captureEntry();
  history.pushState({ scrollY: window.scrollY, focusKey: null } satisfies HistoryEntryState, '', url.pathname + url.search);
  await api('/api/me/preferences', { method: 'PATCH', body: change }).catch(() => undefined);
  await rerenderInPlace();
}

function headerLink(href: string, text: string): HTMLAnchorElement {
  const link = el('a', { href, 'data-focus-key': `nav:${href}` }, [text]);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(href);
  });
  return link;
}

function renderHeader(): void {
  clear(frame.header);
  const wordmark = headerLink('/', 'KIPWELL');
  wordmark.className = 'wordmark';
  const langSelect = el('select', { 'aria-label': t('ui.language'), 'data-focus-key': 'header:lang' }, [
    el('option', { value: 'en', selected: state.lang === 'en' }, ['English']),
    el('option', { value: 'de', selected: state.lang === 'de' }, ['Deutsch']),
    el('option', { value: 'ar', selected: state.lang === 'ar' }, ['العربية']),
  ]);
  langSelect.addEventListener('change', () => {
    void changePreference({ lang: langSelect.value as Lang });
  });
  const curSelect = el('select', { 'aria-label': t('ui.currency'), 'data-focus-key': 'header:cur' }, [
    ...CURS.map((code) => el('option', { value: code, selected: state.cur === code }, [code])),
  ]);
  curSelect.addEventListener('change', () => {
    void changePreference({ cur: curSelect.value as Cur });
  });
  const account = state.me.user
    ? headerLink('/account', state.me.user.username)
    : headerLink('/signin', t('ui.sign_in'));
  const links = el('nav', { class: 'header-links' }, [
    headerLink('/destinations', t('ui.destinations')),
    headerLink('/for-properties', t('ui.for_properties')),
    headerLink('/inbox', t('ui.inbox')),
  ]);
  frame.header.append(wordmark, links, langSelect, curSelect, account);
}

export function mountFrame(): void {
  const root = document.getElementById('kip-root') ?? document.body;
  clear(root);
  const regions = frame.regions;
  const regionNode = (node: HTMLElement, name: string, role = 'status'): HTMLElement => {
    node.setAttribute('role', role);
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-label', name);
    node.className = 'live-region';
    return node;
  };
  regions.outage.setAttribute('role', 'alert');
  regions.outage.className = 'outage-band';
  regions.outage.hidden = true;
  frame.header.className = 'site-header';
  frame.main.className = 'site-main';
  frame.main.id = 'main';
  root.append(
    frame.header,
    regions.outage,
    frame.main,
    regionNode(regions.search, t('ui.search_announcements')),
    regionNode(regions.hold, t('ui.hold_announcements')),
    regionNode(regions.dateHelp, t('ui.date_help')),
    regionNode(regions.linkNotice, t('ui.link_notice')),
    regionNode(regions.roomAdvice, t('ui.room_advice')),
    regionNode(regions.toast, t('ui.toast')),
  );
}

export function relabelRegions(): void {
  frame.regions.search.setAttribute('aria-label', t('ui.search_announcements'));
  frame.regions.hold.setAttribute('aria-label', t('ui.hold_announcements'));
  frame.regions.dateHelp.setAttribute('aria-label', t('ui.date_help'));
  frame.regions.linkNotice.setAttribute('aria-label', t('ui.link_notice'));
  frame.regions.roomAdvice.setAttribute('aria-label', t('ui.room_advice'));
  frame.regions.toast.setAttribute('aria-label', t('ui.toast'));
}

export function startEvents(): void {
  const source = new EventSource('/api/events');
  for (const name of ['clock', 'availability', 'quote.changed', 'hold.expired', 'account.changed']) {
    source.addEventListener(name, (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
      if (name === 'clock' && typeof data.now === 'string') setServerNow(data.now);
      if (name === 'account.changed') applyAccountChange(data);
      emit(name, data);
    });
  }
}

function applyAccountChange(data: Record<string, unknown>): void {
  if (data.signed_out === true) {
    state.me.user = null;
    toast(m('signed.out'));
    navigate('/signin');
    return;
  }
  if (typeof data.tier === 'string') state.me.tier = data.tier as never;
  if (typeof data.completed_stays === 'number') state.me.completed_stays = data.completed_stays;
  let changed = false;
  if (typeof data.lang === 'string' && data.lang !== state.lang) {
    state.lang = data.lang as Lang;
    changed = true;
  }
  if (typeof data.cur === 'string' && data.cur !== state.cur) {
    state.cur = data.cur as Cur;
    changed = true;
  }
  if (changed) {
    const url = new URL(location.href);
    url.searchParams.set('lang', state.lang);
    url.searchParams.set('cur', state.cur);
    history.replaceState(history.state, '', url.pathname + url.search);
    relabelRegions();
    void rerenderInPlace();
  }
}

export function rateLimitedNotice(err: unknown): boolean {
  const failure = failureOf(err);
  if (failure && failure.status === 429) {
    toast(m('rate.limited'));
    return true;
  }
  return false;
}
