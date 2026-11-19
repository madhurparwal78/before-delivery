// A minimal history router: one location, links that navigate without a page load.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((fn) => fn());
window.addEventListener("popstate", notify);

/** Set before navigating by code that wants focus to stay where it is. */
let announceNavigation: (() => void) | null = null;
export const onNavigate = (fn: () => void): void => void (announceNavigation = fn);

export function navigate(to: string, replace = false): void {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  notify();
  announceNavigation?.();
}

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The current pathname. */
export const usePath = (): string => useSyncExternalStore(subscribe, () => window.location.pathname);

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  children: ReactNode;
}

export function Link({ to, children, onClick, ...rest }: LinkProps): ReactNode {
  const click = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={click} {...rest}>
      {children}
    </a>
  );
}
