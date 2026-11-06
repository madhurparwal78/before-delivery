// History-API routing: the address bar is the state of the page.
import { useEffect, useState } from "react";

export interface Location {
  path: string;
  search: string;
  state: unknown;
}

function current(): Location {
  return { path: window.location.pathname, search: window.location.search, state: window.history.state as unknown };
}

const listeners = new Set<() => void>();

export function navigate(to: string, options: { replace?: boolean; state?: unknown } = {}): void {
  const target = new URL(to, window.location.origin);
  const next = `${target.pathname}${target.search}`;
  if (next === `${window.location.pathname}${window.location.search}` && !options.state) return;
  if (options.replace) window.history.replaceState(options.state ?? null, "", next);
  else window.history.pushState(options.state ?? null, "", next);
  for (const listener of listeners) listener();
}

export function useLocation(): Location {
  const [location, setLocation] = useState(current);
  useEffect(() => {
    const update = (): void => setLocation(current());
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return location;
}

/** The sign-in `next` rule: exactly one leading slash, not followed by another slash or a backslash. */
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\u0000-\u001f]/.test(next)) return null;
  return next;
}
