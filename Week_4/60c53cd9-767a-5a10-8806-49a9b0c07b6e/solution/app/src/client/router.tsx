/** A tiny History API router: one store for the address, links that navigate without a page load. */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";

const listeners = new Set<() => void>();

const notifyAll = (): void => {
  for (const listener of listeners) listener();
};

window.addEventListener("popstate", notifyAll);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = (): string => window.location.pathname + window.location.search;

export const useAddress = (): string => useSyncExternalStore(subscribe, snapshot);

/** Moves to a new address inside the document, adding a history entry unless `replace` is set. */
export const navigate = (to: string, replace = false): void => {
  if (to === snapshot()) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  notifyAll();
};

/** Rewrites the address without telling routers, for state a page already holds itself. */
export const writeAddress = (to: string, mode: "push" | "replace"): void => {
  if (to === snapshot()) return;
  if (mode === "push") window.history.pushState(null, "", to);
  else window.history.replaceState(null, "", to);
};

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  readonly to: string;
  readonly children: ReactNode;
}

export const Link = ({ to, children, onClick, ...rest }: LinkProps): ReactNode => {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
};
