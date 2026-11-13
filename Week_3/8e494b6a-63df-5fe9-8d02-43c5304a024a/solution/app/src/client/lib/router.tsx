// A history-API router: the current location as a store, navigation and links that do not reload the page.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
let current = `${window.location.pathname}${window.location.search}`;

window.addEventListener("popstate", () => {
  current = `${window.location.pathname}${window.location.search}`;
  for (const listener of listeners) listener();
});

export function navigate(to: string, replace = false): void {
  if (to === current) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  current = to;
  for (const listener of listeners) listener();
}

interface Location {
  path: string;
  search: URLSearchParams;
}

export function useLocation(): Location {
  const href = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  const [path = "/", search = ""] = href.split("?");
  return { path, search: new URLSearchParams(search) };
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
