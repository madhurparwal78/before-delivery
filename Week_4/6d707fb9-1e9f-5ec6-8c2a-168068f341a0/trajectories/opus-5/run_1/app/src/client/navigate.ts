import { announce, pageData, pick } from './dom';
import { morph } from './morph';
import { copy } from '../server/domain/copy';

let data: Record<string, unknown> = {};
let lastArrival: string | null = null;
let refreshFailed = false;

export function screenData(): Record<string, unknown> {
  return data;
}

export function readData(): void {
  data = pageData();
}

function refreshCopy(): string {
  const held = data.refreshCopy;
  return typeof held === 'string' ? held : copy.refreshFailed;
}

function showRefreshLine(show: boolean): void {
  const line = pick<HTMLElement>('[data-part="refresh-line"]');
  if (!line) return;
  if (data.screen === 'visit') {
    line.hidden = true;
    return;
  }
  line.textContent = show ? refreshCopy() : '';
  line.hidden = !show;
}

function applyArrival(initial: boolean): void {
  const arrival = pick<HTMLElement>('[data-part="arrival"]');
  const key = arrival ? arrival.getAttribute('data-key-value') : null;
  if (initial) {
    lastArrival = key;
    return;
  }
  if (arrival && key !== null && key !== lastArrival) {
    lastArrival = key;
    announce(arrival.textContent ?? '');
  }
}

async function fetchPage(address: string): Promise<Document | null> {
  const answer = await fetch(address, {
    headers: { accept: 'text/html' },
    credentials: 'same-origin',
  });
  if (!answer.ok && answer.status !== 404 && answer.status !== 410) return null;
  const text = await answer.text();
  return new DOMParser().parseFromString(text, 'text/html');
}

function applyDocument(given: Document): void {
  const main = pick('[data-part="main"]');
  const nextMain = pick('[data-part="main"]', given);
  if (main && nextMain) morph(main, nextMain);

  const dialogs = pick('[data-part="dialogs"]');
  const nextDialogs = pick('[data-part="dialogs"]', given);
  if (dialogs && nextDialogs) morph(dialogs, nextDialogs);

  const title = given.querySelector('title');
  if (title) document.title = title.textContent ?? document.title;
  const held = pick('[data-part="page-data"]');
  const next = pick('[data-part="page-data"]', given);
  if (held && next) held.textContent = next.textContent;
  readData();
}

/** Each committed change is one history entry that Back and Forward return to. */
export async function goTo(address: string, mode: 'push' | 'replace' | 'none'): Promise<boolean> {
  const given = await fetchPage(address);
  if (!given) return false;
  if (mode === 'push') history.pushState({}, '', address);
  if (mode === 'replace') history.replaceState({}, '', address);
  applyDocument(given);
  applyArrival(false);
  showRefreshLine(false);
  refreshFailed = false;
  return true;
}

export async function refreshNow(): Promise<void> {
  try {
    const given = await fetchPage(location.pathname + location.search);
    if (!given) {
      refreshFailed = true;
      showRefreshLine(true);
      return;
    }
    applyDocument(given);
    applyArrival(false);
    if (refreshFailed) {
      refreshFailed = false;
      showRefreshLine(false);
    }
  } catch {
    refreshFailed = true;
    showRefreshLine(true);
  }
}

const REFRESHING_SCREENS = new Set([
  'styles',
  'style',
  'materials',
  'scenarios',
  'labels',
  'label',
  'requests',
  'visits',
  'visit',
  'passports',
  'answer',
  'sign-off',
]);

export function startRefresh(): void {
  readData();
  applyArrival(true);
  if (!REFRESHING_SCREENS.has(String(data.screen))) return;
  window.setInterval(() => void refreshNow(), 5000);
}

export function onBack(run: () => void): void {
  window.addEventListener('popstate', run);
}
