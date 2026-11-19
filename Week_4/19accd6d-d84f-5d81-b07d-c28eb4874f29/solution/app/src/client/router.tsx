import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useSyncExternalStore } from "react";

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

/** Moves to another screen of the single page app without reloading. */
export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** The current address as path and query; the hash is read where it matters. */
export function useAddress(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);
}

export function Link({ to, children, onClick, ...rest }: { to: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={follow} {...rest}>
      {children}
    </a>
  );
}
