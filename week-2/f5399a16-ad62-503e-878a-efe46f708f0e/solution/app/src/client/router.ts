// History, with the scroll position and small per-entry memories kept on each entry.

import { useSyncExternalStore } from 'react';

export interface EntryMemory {
  y?: number;
  /** The job row link to focus when coming back to a list. */
  focusLink?: string;
  /** Cursors behind the current page of a list. */
  cursors?: string[];
}

export interface Route {
  path: string;
  search: URLSearchParams;
  hash: string;
  address: string;
  /** How this route came about. */
  by: 'load' | 'push' | 'pop';
  memory: EntryMemory;
}

function read(by: Route['by']): Route {
  return {
    path: location.pathname.length > 1 ? location.pathname.replace(/\/$/, '') : location.pathname,
    search: new URLSearchParams(location.search),
    hash: location.hash,
    address: location.pathname + location.search + location.hash,
    by,
    memory: (history.state ?? {}) as EntryMemory,
  };
}

let current = read('load');
const listeners = new Set<() => void>();

function publish(by: Route['by']): void {
  current = read(by);
  for (const listener of listeners) listener();
}

/** Writes to this entry's memory without a new history entry. */
export function remember(memory: EntryMemory): void {
  history.replaceState({ ...(history.state as EntryMemory | null), ...memory }, '');
  current = { ...current, memory: (history.state ?? {}) as EntryMemory };
}

// The position the person last saw: a press on a sticky control can move the page before its handler runs.
let seenY = 0;

function keepScroll(): void {
  remember({ y: seenY });
}

const RELOAD_KEY = 'clapstick.reloadY';

function keepForReload(): void {
  remember({ y: window.scrollY });
  try {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ address: location.href, y: window.scrollY }));
  } catch {
    // A device that refuses storage reloads at the entry's own memory.
  }
}

/** A reload lands where the page was, even when the entry's memory did not survive. */
function readReloadY(): number | undefined {
  try {
    const kept = JSON.parse(sessionStorage.getItem(RELOAD_KEY) ?? 'null') as { address: string; y: number } | null;
    sessionStorage.removeItem(RELOAD_KEY);
    return kept && kept.address === location.href ? kept.y : undefined;
  } catch {
    return undefined;
  }
}

export function navigate(address: string, options: { replace?: boolean; memory?: EntryMemory } = {}): void {
  if (options.replace) {
    history.replaceState({ ...(history.state as EntryMemory | null), ...options.memory }, '', address);
  } else {
    keepScroll();
    history.pushState(options.memory ?? {}, '', address);
  }
  publish('push');
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

export function startHistory(): void {
  history.scrollRestoration = 'manual';
  addEventListener('scroll', () => { seenY = window.scrollY; }, { passive: true });
  addEventListener('popstate', () => publish('pop'));
  addEventListener('pagehide', keepForReload);
  const y = readReloadY();
  if (y !== undefined) current = { ...current, memory: { ...current.memory, y } };
}

/** Query string with one value changed; empty values leave the address. */
export function withParams(route: Route, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(route.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  const text = next.toString();
  return `${route.path}${text ? `?${text}` : ''}`;
}
