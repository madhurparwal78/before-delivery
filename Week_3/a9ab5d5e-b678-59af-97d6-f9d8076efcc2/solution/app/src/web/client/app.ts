import { Me, api, faultCopy, cachedIdentity, clearToken, handleUnauthorised, loadIdentity, setIdentity, token } from './api';
import { closeAllModals } from './dialogs';
import { hero, pageBand } from './layout';
import { requestCounts } from './requestCounts';
import { clear, el } from './dom';

export interface LogEntry {
  seq: number;
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

const bandTitles: Record<string, string> = {
  '/plan': 'Plan',
  '/requests': 'Requests',
  '/costs': 'Costs',
  '/records': 'Records',
};

const privatePaths = ['/calendar', '/plan', '/requests', '/costs', '/records'];

let activityRegion: HTMLElement;
let streamRegion: HTMLElement;
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

export function navigate(path: string, options: { replace?: boolean; state?: Record<string, unknown> } = {}): void {
  if (options.replace) window.history.replaceState(options.state ?? {}, '', path);
  else window.history.pushState(options.state ?? {}, '', path);
  void render();
}

export function setWaitingCount(count: number): void {
  waitingCount = count;
  const badge = navRegion.querySelector('.waiting-count');
  if (badge) badge.textContent = count > 0 ? String(count) : '';
}

/** The count beside Requests counts sent requests awaiting the signed-in parent's answer. */
async function refreshWaitingCount(me: Me): Promise<void> {
  setWaitingCount((await requestCounts(me)).waiting);
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
  } catch (error) {
    say(faultCopy(error));
    return;
  }
  clearToken();
  setIdentity(null);
  discardKeptDialogs();
  stopStream();
  navigate('/');
}

const DIALOG_STORE_PREFIX = 'twohouse.dialog.';

/** Kept entries belong to the parent who typed them; anyone else signing in, or signing out, clears them. */
export function discardKeptDialogs(): void {
  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith(DIALOG_STORE_PREFIX)) window.sessionStorage.removeItem(key);
  }
}

function dialogStoreKey(): string {
  const me = cachedIdentity();
  return `${DIALOG_STORE_PREFIX}${me ? me.userId : 'anonymous'}`;
}

interface KeptDialog {
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
let connection: AbortController | null = null;
let lastSeq = 0;
const entryListeners = new Set<(entry: LogEntry) => void>();
const RECONNECT_MS = 1000;
const PAUSED_COPY = 'Live updates paused. Reconnecting...';
/** The first connection waits until the screen's own reads are done, so a page load still settles (network idle). */
const FIRST_CONNECTION_DELAY_MS = 900;

export function onLiveEntry(listener: (entry: LogEntry) => void): () => void {
  entryListeners.add(listener);
  return () => entryListeners.delete(listener);
}

/** One connection to the household stream, resumed from the last `seq` whenever it drops. */
function startStream(me: Me, delayMs = 0): void {
  if (streamAbort) return;
  const stream = new AbortController();
  streamAbort = stream;
  void (async () => {
    if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    while (!stream.signal.aborted) {
      const attempt = new AbortController();
      connection = attempt;
      try {
        const response = await fetch(`/api/households/${me.household.id}/events`, {
          headers: {
            Authorization: `Bearer ${token() ?? ''}`,
            ...(lastSeq === 0 ? {} : { 'Last-Event-ID': String(lastSeq) }),
          },
          signal: attempt.signal,
        });
        if (response.status === 401) {
          onUnauthorised();
          return;
        }
        if (!response.ok || !response.body) throw new Error('stream refused');
        streamRegion.textContent = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let split = buffer.indexOf('\n\n');
          while (split >= 0) {
            handleStreamBlock(buffer.slice(0, split));
            buffer = buffer.slice(split + 2);
            split = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // a dropped or refused connection is retried below
      }
      if (stream.signal.aborted) return;
      streamRegion.textContent = PAUSED_COPY;
      await new Promise((resolve) => window.setTimeout(resolve, RECONNECT_MS));
    }
  })();
}

function handleStreamBlock(raw: string): void {
  const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
  if (!dataLine) return;
  const data = dataLine.slice(5).trim();
  const entry = JSON.parse(data) as LogEntry;
  lastSeq = entry.seq;
  const me = cachedIdentity();
  if (me) void refreshWaitingCount(me).catch(() => undefined);
  for (const listener of entryListeners) listener(entry);
}

function stopStream(): void {
  if (streamAbort) {
    streamAbort.abort();
    connection?.abort();
    streamAbort = null;
  }
  lastSeq = 0;
  streamRegion.textContent = '';
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

/** A private screen stays unpainted until its first data is in, so its cards appear at their full size. */
export function revealScreen(): void {
  mainRegion.classList.remove('is-filling');
}

async function render(): Promise<void> {
  const path = window.location.pathname;
  if (currentScreen?.dispose) currentScreen.dispose();
  currentScreen = null;
  registerDialogSnapshot(null);
  closeAllModals();
  let me = cachedIdentity();
  if (!me && token()) {
    try {
      me = await loadIdentity();
    } catch (error) {
      showFault(error);
      return;
    }
    if (!me) clearToken();
  }
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
    void refreshWaitingCount(me).catch(() => undefined);
  }
  else if (!me) stopStream();
  navRegion.hidden = !(me && match?.privatePage);
  const params: Record<string, string> = {};
  const found = match ? match.pattern.exec(path) : null;
  if (found?.groups) Object.assign(params, found.groups);
  clear(mainRegion);
  mainRegion.classList.toggle('is-filling', Boolean(me && match?.privatePage));
  const title = bandTitles[path];
  if (title) mainRegion.append(pageBand(title));
  if (!match) {
    const factory = await notFoundScreen();
    currentScreen = factory(params);
  } else {
    const factory = await match.load();
    currentScreen = factory(params);
  }
  try {
    await currentScreen.mount(mainRegion);
  } catch (error) {
    showFault(error);
  }
  revealScreen();
  if (me && match?.privatePage) startStream(me, FIRST_CONNECTION_DELAY_MS);
}

let notFoundFactory: (() => Promise<ScreenFactory>) | null = null;

export function registerNotFound(load: () => Promise<ScreenFactory>): void {
  notFoundFactory = load;
}

async function notFoundScreen(): Promise<ScreenFactory> {
  if (!notFoundFactory) throw new Error('no not-found screen');
  return notFoundFactory();
}

/** An outage or fault in place of a screen: one plain sentence and a way to retry. */
function showFault(error: unknown): void {
  navRegion.hidden = true;
  const retry = el('button', { type: 'button', class: 'pill', text: 'Try again' });
  retry.addEventListener('click', () => void render());
  clear(mainRegion);
  mainRegion.append(
    hero([el('section', { class: 'card fault-card' }, [el('p', { class: 'fault-line', text: faultCopy(error) }), retry])]),
  );
}

const FONT_FACES = ['400 1em "Dela Gothic One"', '400 1em "DM Sans"', '500 1em "DM Sans"', '700 1em "DM Sans"'];
const FONT_WAIT_MS = 1000;

/** Text is first laid out in its own face, so no swap moves it; a font that is slow or fails waits no longer. */
function fontsSettled(): Promise<unknown> {
  return Promise.race([
    Promise.allSettled(FONT_FACES.map((face) => document.fonts.load(face))),
    new Promise((resolve) => window.setTimeout(resolve, FONT_WAIT_MS)),
  ]);
}

export function mountApp(): void {
  const root = document.getElementById('app') as HTMLElement;
  activityRegion = el('div', { role: 'status', 'aria-label': 'Activity', class: 'activity' });
  navRegion = buildNav();
  navRegion.hidden = true;
  mainRegion = el('main', { class: 'page' });
  streamRegion = el('div', { role: 'status', 'aria-label': 'Live updates', class: 'stream-banner' });
  root.append(activityRegion, streamRegion, navRegion, mainRegion);
  handleUnauthorised(onUnauthorised);
  window.addEventListener('popstate', () => {
    void render();
  });
  window.addEventListener('offline', () => connection?.abort());
  void fontsSettled().then(render);
}
