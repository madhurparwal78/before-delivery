// The page address: path and query live in the URL so a reload or a shared link restores them.
import { useEffect, useState } from "react";

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());
window.addEventListener("popstate", notify);

export function navigate(to: string): void {
  history.pushState(null, "", to);
  notify();
}

/** Rewrites query parameters in place: no history entry is added. */
export function replaceQuery(changes: Record<string, string | null>): void {
  const url = new URL(location.href);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  history.replaceState(history.state, "", `${url.pathname}${url.search}`);
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = (): void => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}
