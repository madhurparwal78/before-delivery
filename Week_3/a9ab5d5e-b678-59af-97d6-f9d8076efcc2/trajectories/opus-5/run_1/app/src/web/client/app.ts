import { Me, api, cachedIdentity, clearToken, handleUnauthorised, loadIdentity, setIdentity, token } from './api';
import { clear, el } from './dom';

export interface LogEntry {
  seq: string;
  at: string;
  actor: string;
  type: string;
  subjectId: string | null;
}

export interface Screen {
  mount(main: HTMLElement): Promise<void> | void;
  onEntry?(entry: LogEntry): void;
  dispose?(): void;
}

const privatePaths = ['/calendar', '/plan', '/requests', '/costs', '/records'];

let activityRegion: HTMLElement;
let navRegion: HTMLElement;
let mainRegion: HTMLElement;
let currentScreen: Screen | null = null;
let waitingCount = 0;

export function say(message: string): void {
  activityRegion.textContent = '';
  window.setTimeout(() => {
    activityRegion.textContent = message;
  }, 10);
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render();
}

export function setWaitingCount(count: number): void {
  waitingCount = count;
  const badge = navRegion.querySelector('.waiting-count');
  if (badge) badge.textContent = count > 0 ? String(count) : '';
}

/** The count beside Requests counts sent requests awaiting the signed-in parent's answer. */
export async function refreshWaitingCount(me: Me): Promise<void> {
  const base = `/api/households/${me.household.id}`;
  const [swaps, costs] = await Promise.all([
    api<{ items: { createdBy: string }[] }>('GET', `${base}/swaps?state=sent&limit=100`),
    api<{ items: { paidBy: string }[] }>('GET', `${base}/costs?state=sent&limit=100`),
  ]);
  setWaitingCount(
    swaps.data.items.filter((item) => item.createdBy !== me.role).length +
      costs.data.items.filter((item) => item.paidBy !== me.role).length,
  );
}

function buildNav(): HTMLElement {
  const nav = el('nav', { 'aria-label': 'Household', class: 'household-bar' });
  const wordmark = el('span', { class: 'wordmark', text: 'Twohouse' });
  const links = el('div', { class: 'bar-links' });
  for (const [label, path] of [
    ['Calendar', '/calendar'],
    ['Plan', '/plan'],
    ['Requests', '/requests'],
    ['Costs', '/costs'],
    ['Records', '/records'],
  ] as [string, string][]) {
    const link = el('a', { href: path, class: 'bar-link' }, [el('span', { text: label })]);
    if (label === 'Requests') {
      link.append(el('span', { class: 'waiting-count', 'aria-hidden': 'true', text: waitingCount > 0 ? String(waitingCount) : '' }));
    }
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(path);
    });
    links.append(link);
  }
  const signOut = el('button', { type: 'button', class: 'bar-signout', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void signOutNow();
  });
  nav.append(wordmark, links, signOut);
  return nav;
}

async function signOutNow(): Promise<void> {
  try {
    await api('DELETE', '/api/session');
  } catch {
    /* the session is gone either way */
  }
  clearToken();
  setIdentity(null);
  window.sessionStorage.removeItem(dialogStoreKey());
  stopStream();
  navigate('/');
}

export function dialogStoreKey(): string {
  const me = cachedIdentity();
  return `twohouse.dialog.${me ? me.userId : 'anonymous'}`;
}

export interface KeptDialog {
  kind: 'swap' | 'cost';
  values: Record<string, string>;
}

export function keepDialog(kept: KeptDialog): void {
  window.sessionStorage.setItem(dialogStoreKey(), JSON.stringify(kept));
}

export function takeKeptDialog(): KeptDialog | null {
  const raw = window.sessionStorage.getItem(dialogStoreKey());
  if (!raw) return null;
  window.sessionStorage.removeItem(dialogStoreKey());
  return JSON.parse(raw) as KeptDialog;
}

let dialogSnapshot: (() => KeptDialog | null) | null = null;

export function registerDialogSnapshot(snapshot: (() => KeptDialog | null) | null): void {
  dialogSnapshot = snapshot;
}

/** A 401 on any read, write or stream sends the parent to sign in with their entries kept. */
function onUnauthorised(): void {
  const kept = dialogSnapshot ? dialogSnapshot() : null;
  if (kept) keepDialog(kept);
  clearToken();
  setIdentity(null);
  stopStream();
  const here = `${window.location.pathname}${window.location.search}`;
  if (privatePaths.includes(window.location.pathname)) {
    window.history.replaceState({}, '', `/?next=${encodeURIComponent(here)}`);
    void render();
  }
}

let streamAbort: AbortController | null = null;
let streamSeq = '0';
const entryListeners = new Set<(entry: LogEntry) => void>();

export function onLiveEntry(listener: (entry: LogEntry) => void): () => void {
  entryListeners.add(listener);
  return () => entryListeners.delete(listener);
}

export function startStream(me: Me): void {
  if (streamAbort) return;
  const controller = new AbortController();
  streamAbort = controller;
  void (async () => {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch(`/api/households/${me.household.id}/events`, {
          headers: {
            Authorization: `Bearer ${token() ?? ''}`,
            ...(streamSeq === '0' ? {} : { 'Last-Event-ID': streamSeq }),
          },
          signal: controller.signal,
        });
        if (response.status === 401) {
          onUnauthorised();
          return;
        }
        if (!response.body) throw new Error('no stream body');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let split = buffer.indexOf('\n\n');
          while (split >= 0) {
            const raw = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            handleStreamBlock(raw);
            split = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        say('Live updates paused. Reconnecting...');
      }
      if (controller.signal.aborted) return;
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  })();
}

function handleStreamBlock(raw: string): void {
  let id: string | null = null;
  let data: string | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    if (line.startsWith('data:')) data = line.slice(5).trim();
  }
  if (!id || !data) return;
  streamSeq = id;
  const entry = JSON.parse(data) as LogEntry;
  const me = cachedIdentity();
  if (me) void refreshWaitingCount(me).catch(() => undefined);
  for (const listener of entryListeners) listener(entry);
}

export function stopStream(): void {
  if (streamAbort) {
    streamAbort.abort();
    streamAbort = null;
  }
  streamSeq = '0';
}

export function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.includes('\\')) return null;
  const [path] = raw.split('?');
  if (!path || !privatePaths.includes(path)) return null;
  return raw;
}

type ScreenFactory = (params: Record<string, string>) => Screen;

const screens: { pattern: RegExp; privatePage: boolean; load: () => Promise<ScreenFactory> }[] = [];

export function registerScreen(
  pattern: RegExp,
  privatePage: boolean,
  load: () => Promise<ScreenFactory>,
): void {
  screens.push({ pattern, privatePage, load });
}

export async function render(): Promise<void> {
  const path = window.location.pathname;
  if (currentScreen?.dispose) currentScreen.dispose();
  currentScreen = null;
  registerDialogSnapshot(null);
  let me = cachedIdentity();
  if (!me && token()) me = await loadIdentity();
  if (!me && token()) clearToken();
  if ((path === '/' || path === '/start') && me) {
    window.history.replaceState({}, '', '/calendar');
    await render();
    return;
  }
  const match = screens.find((candidate) => candidate.pattern.test(path));
  if (match?.privatePage && !me) {
    const here = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, '', `/?next=${encodeURIComponent(here)}`);
    await render();
    return;
  }
  if (me && match?.privatePage) {
    startStream(me);
    void refreshWaitingCount(me).catch(() => undefined);
  }
  else if (!me) stopStream();
  navRegion.hidden = !(me && match?.privatePage);
  const params: Record<string, string> = {};
  const found = match ? match.pattern.exec(path) : null;
  if (found?.groups) Object.assign(params, found.groups);
  clear(mainRegion);
  if (!match) {
    const factory = await notFoundScreen();
    currentScreen = factory(params);
  } else {
    const factory = await match.load();
    currentScreen = factory(params);
  }
  await currentScreen.mount(mainRegion);
}

let notFoundFactory: (() => Promise<ScreenFactory>) | null = null;

export function registerNotFound(load: () => Promise<ScreenFactory>): void {
  notFoundFactory = load;
}

async function notFoundScreen(): Promise<ScreenFactory> {
  if (!notFoundFactory) throw new Error('no not-found screen');
  return notFoundFactory();
}

export function mountApp(): void {
  const root = document.getElementById('app') as HTMLElement;
  activityRegion = el('div', { role: 'status', 'aria-label': 'Activity', class: 'activity' });
  navRegion = buildNav();
  navRegion.hidden = true;
  mainRegion = el('main', { class: 'page' });
  root.append(activityRegion, navRegion, mainRegion);
  handleUnauthorised(onUnauthorised);
  window.addEventListener('popstate', () => {
    void render();
  });
  void render();
}
