// The address bar is the source of truth for the screen and, on the board and the usage sheet,
// for the kitchen day.

import { useSyncExternalStore } from "react";

interface Place {
  path: string;
  search: URLSearchParams;
  /** A one-time message handed to the next screen (the application success copy). */
  notice: string | null;
}

let notice: string | null = null;
let current = read();
const listeners = new Set<() => void>();

function read(): Place {
  return { path: location.pathname, search: new URLSearchParams(location.search), notice };
}

function emit(): void {
  current = read();
  for (const listener of listeners) listener();
}

addEventListener("popstate", () => {
  notice = null;
  emit();
});

export function navigate(to: string, options: { replace?: boolean; notice?: string } = {}): void {
  notice = options.notice ?? null;
  if (`${location.pathname}${location.search}` === to && !options.replace) {
    emit();
    return;
  }
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  emit();
}

export function usePlace(): Place {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
