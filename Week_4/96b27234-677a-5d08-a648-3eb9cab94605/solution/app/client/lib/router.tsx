import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { clearNotices } from "./store";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
};

const snapshot = (): string => `${window.location.pathname}${window.location.search}`;

export const useLocation = (): string => useSyncExternalStore(subscribe, snapshot);

export function navigate(to: string, replace = false): void {
  if (to === snapshot()) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  clearNotices();
  listeners.forEach((listener) => listener());
}

/** A same-site path to return to after signing in; anything else is ignored. */
export function safeNext(value: string | null): string {
  return value && /^\/(?!\/)[^\\\s]*$/.test(value) ? value : "/sessions";
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string;
  children: ReactNode;
}

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const go = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={go} {...rest}>
      {children}
    </a>
  );
}
