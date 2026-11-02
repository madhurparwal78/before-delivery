import { useSyncExternalStore, type ComponentProps, type MouseEvent } from "react";

// A small History API router: the URL is the state, and every page reads it.

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
};
const location = () => window.location.pathname + window.location.search;

export function useLocation(): { path: string; search: URLSearchParams } {
  const full = useSyncExternalStore(subscribe, location);
  const [path, query = ""] = full.split("?");
  return { path, search: new URLSearchParams(query) };
}

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo({ top: 0, behavior: "instant" });
  for (const listener of listeners) listener();
}

/** The path of an internal link, or null for a link the browser should follow itself. */
function internal(href: string | undefined): string | null {
  if (!href || !href.startsWith("/") || href.startsWith("/api/")) return null;
  return href;
}

export function Link({ href, onClick, ...rest }: ComponentProps<"a"> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const to = internal(href);
    if (event.defaultPrevented || !to || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={href} onClick={handle} {...rest} />;
}

export function match(pattern: RegExp, path: string): string[] | null {
  const m = pattern.exec(path);
  return m ? m.slice(1) : null;
}
