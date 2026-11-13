// A small history router: the page address is the source of truth for the route and, on the
// timeline, for the search state (brief: Interactions › Search and filter).

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener("popstate", notify);

function navigate(to: string): void {
  if (to === location.pathname + location.search) return;
  history.pushState(null, "", to);
  window.scrollTo({ top: 0, behavior: "instant" });
  notify();
}

/** Replaces the address without adding a history entry. */
export function replaceAddress(to: string): void {
  history.replaceState(null, "", to);
}

export function useLocation(): { path: string; search: string } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return { path: location.pathname, search: location.search };
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** An ordinary link that navigates in place; modified clicks still open normally. */
export function Link({ href, onNavigate, onClick, ...rest }: LinkProps) {
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onNavigate?.(event);
        navigate(href);
      }}
      {...rest}
    />
  );
}
