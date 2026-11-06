// A small History API router: the URL is the state of every screen.
import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

const snapshot = (): string => location.pathname + location.search;

interface NavigateOptions {
  replace?: boolean;
  state?: Record<string, unknown>;
}

export function navigate(to: string, options: NavigateOptions = {}): void {
  history[options.replace ? "replaceState" : "pushState"](options.state ?? null, "", to);
  listeners.forEach((l) => l());
  if (!options.replace) window.scrollTo({ top: 0, behavior: "instant" });
}

export function useLocation(): { pathname: string; search: URLSearchParams; path: string } {
  const path = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(path, location.origin);
  return { pathname: url.pathname, search: url.searchParams, path };
}

export function historyState(): Record<string, unknown> {
  return (history.state as Record<string, unknown> | null) ?? {};
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={follow} {...rest} />;
}
