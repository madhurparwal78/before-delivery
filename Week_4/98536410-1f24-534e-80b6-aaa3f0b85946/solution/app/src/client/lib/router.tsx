import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener("popstate", notify);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string {
  return location.pathname + location.search;
}

interface Location {
  pathname: string;
  search: string;
}

export function useLocation(): Location {
  const full = useSyncExternalStore(subscribe, snapshot);
  const cut = full.indexOf("?");
  return cut < 0 ? { pathname: full, search: "" } : { pathname: full.slice(0, cut), search: full.slice(cut) };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  notify();
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={follow} {...rest} />;
}
