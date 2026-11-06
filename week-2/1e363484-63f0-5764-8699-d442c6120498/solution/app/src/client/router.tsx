// A small history router: the address bar is the source of truth for which screen shows.

import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
window.addEventListener("popstate", notify);

interface NavigateOptions {
  replace?: boolean;
  state?: Record<string, unknown>;
}

export function navigate(to: string, { replace = false, state = {} }: NavigateOptions = {}): void {
  if (replace) history.replaceState(state, "", to);
  else history.pushState(state, "", to);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const snapshot = () => location.pathname;

/** The current path; screens read their query and history state themselves. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, snapshot);
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  return <a href={href} onClick={follow} {...rest} />;
}
