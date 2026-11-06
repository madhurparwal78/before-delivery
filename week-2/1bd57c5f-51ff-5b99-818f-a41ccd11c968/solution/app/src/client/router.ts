import { useSyncExternalStore } from "react";

// A small history router: the path is the state, links and code navigate with pushState.

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

export function navigate(path: string, options: { replace?: boolean; state?: Record<string, unknown> } = {}): void {
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method](options.state ?? null, "", path);
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => window.location.pathname,
  );
}

/** Handles a same-origin link click without a page load (modified clicks still open normally). */
export function followLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href") ?? "/");
}
