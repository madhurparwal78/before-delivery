// A small history router: the address is the source of truth for every page that keeps state in it.
import { useSyncExternalStore } from "react";

interface Location {
  pathname: string;
  search: string;
}

const CHANGE = "tinework:navigate";
let cached: Location = { pathname: window.location.pathname, search: window.location.search };

function snapshot(): Location {
  if (cached.pathname !== window.location.pathname || cached.search !== window.location.search) {
    cached = { pathname: window.location.pathname, search: window.location.search };
  }
  return cached;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(CHANGE, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(CHANGE, listener);
  };
}

export function useLocation(): Location {
  return useSyncExternalStore(subscribe, snapshot);
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(window.history.state, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(CHANGE));
}

/** Rewrites the address in place: no history entry and no re-render of components that ignore it. */
export function rewrite(to: string): void {
  window.history.replaceState(window.history.state, "", to);
  window.dispatchEvent(new Event(CHANGE));
}

export function queryOf(search: string): URLSearchParams {
  return new URLSearchParams(search);
}
