import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

/** Moves to another route of the app without a page load. `replace` keeps the history length. */
export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  for (const listener of listeners) listener();
}

/** Rewrites the current address in place (no history entry), for state that lives in the URL. */
export function replaceSearch(search: string): void {
  history.replaceState(null, '', `${location.pathname}${search}${location.hash}`);
  for (const listener of listeners) listener();
}

export const usePath = (): string => useSyncExternalStore(subscribe, () => location.pathname);
export const useSearch = (): string => useSyncExternalStore(subscribe, () => location.search);
