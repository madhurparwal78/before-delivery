import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const CHANGED = 'mullion:navigate';

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener('popstate', listener);
    window.removeEventListener(CHANGED, listener);
  };
}

/** The current path and query, e.g. `/signin?next=%2F`. */
export const useLocation = (): string => useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={follow} {...rest} />;
}

export const signInPath = (next: string): string => `/signin?next=${encodeURIComponent(next)}`;
