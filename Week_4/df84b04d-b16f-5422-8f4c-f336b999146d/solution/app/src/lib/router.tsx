import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const change = () => { for (const listener of listeners) listener(); };

window.addEventListener("popstate", change);

export function useLocation(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => location.pathname + location.search,
  );
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  change();
}

export function Link({ to, onClick, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
