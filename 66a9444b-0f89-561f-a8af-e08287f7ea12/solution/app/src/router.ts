// The URL is the state: pathname picks the screen, the query carries filters and the checkout step.
import { useSyncExternalStore } from "react";

const EVENT = "kf:navigate";

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(EVENT, listener);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  return { pathname: url.pathname, search: url.searchParams };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
}

/** Rewrites some query keys of the current URL (null removes a key). */
export function setQuery(changes: Record<string, string | null>, options: { replace?: boolean } = {}): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  navigate(url.pathname + (url.searchParams.size ? `?${url.searchParams}` : "") + url.hash, options);
}
