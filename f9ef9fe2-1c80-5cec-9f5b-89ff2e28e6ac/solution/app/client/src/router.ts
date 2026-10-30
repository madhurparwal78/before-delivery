import { useSyncExternalStore } from "react";

// History-API routing for the eight screens.

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const snapshot = (): string => window.location.pathname + window.location.search;

export function useLocation(): URL {
  const href = useSyncExternalStore(subscribe, snapshot);
  return new URL(href, window.location.origin);
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  listeners.forEach((listener) => listener());
}

/** Rewrites the address without adding a history entry and without re-rendering subscribers. */
export function replaceAddress(to: string): void {
  if (snapshot() !== to) window.history.replaceState(null, "", to);
}
