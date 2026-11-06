// The address carries each screen's view (board date, report month, invoice member and month).

import { useEffect, useState } from "preact/hooks";

interface Address { path: string; query: URLSearchParams }

const read = (): Address => ({ path: location.pathname, query: new URLSearchParams(location.search) });
const listeners = new Set<() => void>();

/** Adds one history entry (or replaces the current one) and tells every screen. */
export function navigate(url: string, replace = false): void {
  if (url === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  for (const l of listeners) l();
}

addEventListener("popstate", () => {
  for (const l of listeners) l();
});

export function useAddress(): Address {
  const [address, setAddress] = useState(read);
  useEffect(() => {
    const update = (): void => setAddress(read());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return address;
}

export function withQuery(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

/** The published signed-in screens: the only paths a `next` address may name. */
const SCREENS = ["/board", "/bookings", "/documents", "/invoices", "/reports", "/sanitation", "/settings"];

/**
 * Where sign-in lands: `next` (already percent-decoded once by URLSearchParams) when its path is
 * exactly a published signed-in screen, optionally followed by a query, and nothing in it could
 * leave the origin; otherwise the board.
 */
export function returnTarget(search: string): string {
  const next = new URLSearchParams(search).get("next");
  if (next === null) return "/board";
  // Backslash, control characters, a fragment, userinfo, a scheme or a leading double slash, anywhere.
  if (/[\\\u0000-\u001f\u007f#@]/.test(next) || next.startsWith("//") || next.includes("://")) return "/board";
  const match = /^(\/[a-z]+)(\?.*)?$/.exec(next);
  return match && SCREENS.includes(match[1]!) ? next : "/board";
}

/** The sign-in address for a screen: `/?next=` with its path and query, percent-encoded; plain `/` for anything else. */
export function signInAddress(path: string, search: string): string {
  return SCREENS.includes(path) ? `/?next=${encodeURIComponent(path + search)}` : "/";
}
