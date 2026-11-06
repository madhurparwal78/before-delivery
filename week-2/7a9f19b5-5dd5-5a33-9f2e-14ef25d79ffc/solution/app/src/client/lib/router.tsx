import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let previous: string | null = null;

/** The in-app page the visitor was on before the current one, if any. */
export function previousPath(): string | null {
  return previous;
}

/** Moves to another page of the app without a reload. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  previous = location.pathname + location.search;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  notify();
  if (!options.replace) window.scrollTo({ top: 0, behavior: "instant" });
}

/** Rewrites the query string in place: no reload, no new history entry. */
export function replaceQuery(params: URLSearchParams): void {
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}`);
  notify();
}

export function useLocation(): { path: string; search: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const url = new URL(href, location.origin);
  return { path: url.pathname, search: url.searchParams };
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={follow} {...rest} />;
}
