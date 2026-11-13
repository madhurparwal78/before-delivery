import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  listeners.forEach((listener) => listener());
}

/** The current location, path and query together. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => location.pathname + location.search);
}
