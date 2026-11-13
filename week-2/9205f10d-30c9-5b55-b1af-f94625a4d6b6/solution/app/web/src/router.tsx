import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

export function navigate(to: string, options: { replace?: boolean; state?: unknown } = {}): void {
  if (options.replace) history.replaceState(options.state ?? null, "", to);
  else history.pushState(options.state ?? null, "", to);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): string => `${location.pathname}${location.search}`;

interface Place {
  path: string;
  query: URLSearchParams;
  /** The state passed to navigate(), e.g. a status message to show on arrival. */
  state: unknown;
}

export function usePlace(): Place {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams, state: history.state };
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; state?: unknown };

/** An in-app link: a real anchor, navigated without a page load. */
export function Link({ to, state, onClick, ...rest }: LinkProps) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, { state });
  };
  return <a href={to} onClick={follow} {...rest} />;
}
