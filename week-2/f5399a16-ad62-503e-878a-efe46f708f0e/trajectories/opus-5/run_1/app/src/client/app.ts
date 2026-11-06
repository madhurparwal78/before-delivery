import { COPY } from '../domain/copy.js';
import { matchScreen, pageTitle } from '../domain/screens.js';
import type { ScreenMatch, ScreenName } from '../domain/screens.js';
import { ApiRefusal, api, isRefusal } from './api.js';
import type { Child } from './dom.js';
import { h, render } from './dom.js';
import { NORMAL, animate, reducedMotion, settled } from './motion.js';

export type Desk = { id: string; name: string; email: string };

export type SurfaceKind = 'dialog' | 'sheet';

export type Surface = {
  name: string;
  kind: SurfaceKind;
  sheet?: 'filters' | 'menu' | 'notes';
  opener: string;
  values: Record<string, string>;
  problems: Record<string, string>;
  message: string | null;
  payload: Record<string, unknown>;
  phase: 'open' | 'closing';
  token: number;
};

export type MenuState = {
  name: string;
  opener: string;
  payload: Record<string, unknown>;
  items: { label: string; run: () => void }[];
};

export type AppState = {
  path: string;
  query: URLSearchParams;
  screen: ScreenMatch;
  session: Desk | null;
  data: Record<string, unknown>;
  loading: boolean;
  announcement: string | null;
  refreshFailed: boolean;
  problems: Record<string, string>;
  surfaces: Surface[];
  menu: MenuState | null;
  pending: Set<string>;
  heading: string;
  language: string;
  direction: 'ltr' | 'rtl';
  sessionEnded: boolean;
  drafts: Record<string, string>;
};

export const state: AppState = {
  path: location.pathname,
  query: new URLSearchParams(location.search),
  screen: matchScreen(location.pathname),
  session: null,
  data: {},
  loading: true,
  announcement: null,
  refreshFailed: false,
  problems: {},
  surfaces: [],
  menu: null,
  pending: new Set(),
  heading: '',
  language: 'en',
  direction: 'ltr',
  sessionEnded: false,
  drafts: {},
};

export type Screen = {
  name: ScreenName;
  /** Reads the screen's data from the server. */
  load?: () => Promise<Record<string, unknown>>;
  heading: (data: Record<string, unknown>) => string;
  /** The lines the level-one heading reveals. */
  headingLines?: (data: Record<string, unknown>) => string[];
  view: (data: Record<string, unknown>) => Child[];
  /** What sits in the fixed bottom bar at 375x812. */
  mainAction?: (data: Record<string, unknown>) => Child;
  /** Re-reads its data from the server every 5 seconds while open. */
  refreshes?: boolean;
  /** Signed-in screens carry the rail; private pages carry their own frame. */
  frame: 'public' | 'desk' | 'private';
  /** A screen that places the level-one heading itself, as the hero card does. */
  ownHeading?: boolean;
};

const screens = new Map<ScreenName, Screen>();

export function registerScreen(screen: Screen): void {
  screens.set(screen.name, screen);
}

export function currentScreen(): Screen | null {
  return screens.get(state.screen.name) ?? null;
}

let redrawQueued = false;

export function redraw(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    draw();
  });
}

let drawShell: () => void = () => undefined;

export function setShellDrawer(drawer: () => void): void {
  drawShell = drawer;
}

function draw(): void {
  drawShell();
}

/** `status "Announcements"` keeps a repeated message announced twice. */
export function announce(message: string): void {
  const region = document.getElementById('announcements');
  if (region === null) return;
  render(region, []);
  state.announcement = message;
  requestAnimationFrame(() => {
    render(region, [h('p', { class: 'announcement' }, message)]);
  });
}

/** While a button's request is open its name reads `Working…` and it sends nothing. */
export function isPending(key: string): boolean {
  return state.pending.has(key);
}

export async function run<T>(key: string, work: () => Promise<T>): Promise<T | undefined> {
  if (state.pending.has(key)) return undefined;
  state.pending.add(key);
  redraw();
  try {
    return await work();
  } catch (error) {
    handleFailure(error);
    return undefined;
  } finally {
    state.pending.delete(key);
    redraw();
  }
}

export function handleFailure(error: unknown): void {
  if (!isRefusal(error)) {
    announce(COPY.refreshFailed);
    return;
  }
  const failure = error.failure;
  if (failure.code === 'session_ended') {
    state.sessionEnded = true;
    state.session = null;
    announce(COPY.sessionEnded);
    redraw();
    return;
  }
  const surface = topSurface();
  if (surface !== undefined) {
    surface.problems = failure.fields;
    surface.message = failure.message;
  } else {
    state.problems = failure.fields;
  }
  announce(failure.message);
  redraw();
}

export function topSurface(): Surface | undefined {
  return [...state.surfaces].reverse().find((surface) => surface.phase === 'open');
}

let surfaceToken = 0;

export function openSurface(
  name: string,
  opener: string,
  options: {
    kind?: SurfaceKind;
    sheet?: 'filters' | 'menu' | 'notes';
    values?: Record<string, string>;
    payload?: Record<string, unknown>;
  } = {},
): void {
  const already = state.surfaces.find((surface) => surface.name === name);
  if (already) {
    already.phase = 'open';
    already.token = ++surfaceToken;
    redraw();
    focusInsideSurface(name);
    return;
  }
  state.surfaces.push({
    name,
    kind: options.kind ?? 'dialog',
    ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
    opener,
    values: options.values ?? {},
    problems: {},
    message: null,
    payload: options.payload ?? {},
    phase: 'open',
    token: ++surfaceToken,
  });
  redraw();
  focusInsideSurface(name);
}

/**
 * Closing returns focus to the opener at once and leaves the page behind usable
 * while the closing animation still runs.
 */
export function closeSurface(name: string): void {
  const surface = state.surfaces.find((candidate) => candidate.name === name);
  if (!surface || surface.phase === 'closing') return;
  surface.phase = 'closing';
  const token = surface.token;
  const opener = document.getElementById(surface.opener);
  redraw();
  if (opener instanceof HTMLElement) opener.focus();
  const wait = reducedMotion() ? 0 : NORMAL;
  setTimeout(() => {
    const held = state.surfaces.find((candidate) => candidate.name === name);
    if (held && held.token === token && held.phase === 'closing') {
      state.surfaces = state.surfaces.filter((candidate) => candidate !== held);
      redraw();
    }
  }, wait);
}

export function surfaceOf(name: string): Surface | undefined {
  return state.surfaces.find((surface) => surface.name === name);
}

export function openSurfaces(): Surface[] {
  return state.surfaces.filter((surface) => surface.phase === 'open');
}

function focusInsideSurface(name: string): void {
  requestAnimationFrame(() => {
    const element = document.querySelector(`[data-surface-name="${cssEscape(name)}"]`);
    if (!(element instanceof HTMLElement)) return;
    const first = element.querySelector<HTMLElement>(
      'input:not([type=hidden]), textarea, select, [role=combobox]',
    );
    (first ?? element.querySelector<HTMLElement>('button, a[href], [tabindex="0"]'))?.focus();
  });
}

export function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Focus moves to the level-one heading when the control that opened a thing is gone. */
export function focusHeading(): void {
  requestAnimationFrame(() => {
    document.getElementById('screen-heading')?.focus();
  });
}

export function focusBack(openerId: string): void {
  requestAnimationFrame(() => {
    const opener = document.getElementById(openerId);
    if (opener instanceof HTMLElement) opener.focus();
    else document.getElementById('screen-heading')?.focus();
  });
}

let navigationToken = 0;
let refreshTimer: number | null = null;

export function queryOf(): URLSearchParams {
  return state.query;
}

/** Each committed change is one history entry. */
export function setQuery(
  changes: Record<string, string | null>,
  options: { replace?: boolean } = {},
): void {
  const next = new URLSearchParams(state.query);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) next.delete(name);
    else next.set(name, value);
  }
  const search = next.toString();
  const address = `${state.path}${search === '' ? '' : `?${search}`}`;
  if (options.replace === true) history.replaceState(scrollMark(), '', address);
  else history.pushState(scrollMark(), '', address);
  state.query = next;
  void loadData();
}

function scrollMark(): { scrollY: number } {
  return { scrollY: window.scrollY };
}

export async function go(address: string, options: { replace?: boolean } = {}): Promise<void> {
  const url = new URL(address, location.origin);
  if (options.replace === true) history.replaceState(scrollMark(), '', address);
  else history.pushState(scrollMark(), '', address);
  await show(url.pathname, url.searchParams, { wipe: true });
}

export async function show(
  path: string,
  query: URLSearchParams,
  options: { wipe?: boolean; restoreScroll?: number | null } = {},
): Promise<void> {
  const token = ++navigationToken;
  const wasPublic = currentScreen()?.frame === 'public';
  state.path = path;
  state.query = query;
  state.screen = matchScreen(path);
  state.surfaces = [];
  state.menu = null;
  state.problems = {};
  state.data = {};
  state.loading = true;
  const next = currentScreen();
  const playWipe =
    options.wipe === true && wasPublic && next?.frame === 'public' && !reducedMotion();

  if (playWipe) {
    const panel = document.createElement('div');
    panel.setAttribute('data-part', 'route-wipe');
    panel.className = 'route-wipe';
    document.body.append(panel);
    const shell = document.getElementById('shell');
    shell?.setAttribute('inert', '');
    await settled(
      animate(panel, [{ transform: 'translateX(-100%)' }, { transform: 'translateX(0)' }], NORMAL),
    );
    if (token !== navigationToken) {
      panel.remove();
      shell?.removeAttribute('inert');
      return;
    }
    panel.style.transform = 'translateX(0)';
    redraw();
    await loadData(token);
    shell?.removeAttribute('inert');
    landed(options.restoreScroll ?? null);
    await settled(
      animate(panel, [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], NORMAL),
    );
    panel.remove();
    return;
  }
  redraw();
  await loadData(token);
  landed(options.restoreScroll ?? null);
}

/** Back from a job lands on the link of the job just left, once the list has loaded. */
function landed(restoreScroll: number | null): void {
  requestAnimationFrame(() => {
    const left = sessionStorage.getItem('clapstick-left-job');
    const link =
      left === null || state.screen.name !== 'jobs'
        ? null
        : document.getElementById(`job-link-${left}`);
    if (link instanceof HTMLElement) {
      sessionStorage.removeItem('clapstick-left-job');
      link.focus({ preventScroll: true });
    } else {
      document.getElementById('screen-heading')?.focus({ preventScroll: true });
    }
    window.scrollTo(0, restoreScroll ?? 0);
  });
}

export async function loadData(token = navigationToken): Promise<void> {
  const screen = currentScreen();
  if (!screen?.load) {
    state.loading = false;
    document.title = pageTitle(screen?.heading(state.data) ?? 'Page not found');
    redraw();
    startRefresh();
    return;
  }
  try {
    const data = await screen.load();
    if (token !== navigationToken) return;
    state.data = data;
    state.loading = false;
    state.refreshFailed = false;
  } catch (error) {
    if (token !== navigationToken) return;
    state.loading = false;
    if (isRefusal(error) && error.failure.status === 401) {
      if (error.failure.code === 'session_ended') state.sessionEnded = true;
      state.session = null;
    } else {
      handleFailure(error);
    }
  }
  const heading = currentScreen()?.heading(state.data) ?? 'Page not found';
  state.heading = heading;
  document.title = pageTitle(heading);
  redraw();
  startRefresh();
}

/** Signed-in screens and private pages re-read their data every 5 seconds. */
function startRefresh(): void {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
  const screen = currentScreen();
  if (!screen?.refreshes || !screen.load) return;
  refreshTimer = window.setInterval(() => void refreshOnce(), 5000);
}

export async function refreshOnce(): Promise<void> {
  const screen = currentScreen();
  if (!screen?.load) return;
  const token = navigationToken;
  try {
    const data = await screen.load();
    if (token !== navigationToken) return;
    state.data = data;
    state.refreshFailed = false;
    const heading = screen.heading(state.data);
    state.heading = heading;
    document.title = pageTitle(heading);
    redraw();
  } catch (error) {
    if (token !== navigationToken) return;
    if (isRefusal(error) && error.failure.code === 'session_ended') {
      state.sessionEnded = true;
      state.session = null;
      announce(COPY.sessionEnded);
      redraw();
      return;
    }
    state.refreshFailed = true;
    redraw();
  }
}

export async function readSession(): Promise<void> {
  try {
    state.session = await api<Desk>('/api/session');
    state.sessionEnded = false;
  } catch {
    state.session = null;
  }
}

export { ApiRefusal, api, isRefusal };
