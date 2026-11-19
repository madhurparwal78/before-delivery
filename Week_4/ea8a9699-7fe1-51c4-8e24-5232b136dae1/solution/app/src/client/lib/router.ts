// A small history router: screens read the address; navigation pushes or replaces entries.
import { useSyncExternalStore } from "react";

const EVENT = "rushes:navigate";

export function navigate(to: string, options: { replace?: boolean; state?: Record<string, string> } = {}): void {
  if (options.replace) history.replaceState(options.state ?? null, "", to);
  else history.pushState(options.state ?? null, "", to);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

const snapshot = (): string => `${location.pathname}${location.search}`;

/** The current path and query; re-renders on every navigation, Back and Forward. */
export function useLocation(): { path: string; query: URLSearchParams; href: string } {
  const href = useSyncExternalStore(subscribe, snapshot);
  const [path = "/", search = ""] = href.split("?");
  return { path, query: new URLSearchParams(search), href };
}

/** Navigation that the browser handles for in-app links (keeps modifier-clicks and middle-clicks native). */
export function linkClick(event: React.MouseEvent<HTMLAnchorElement>, to: string): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(to);
}
