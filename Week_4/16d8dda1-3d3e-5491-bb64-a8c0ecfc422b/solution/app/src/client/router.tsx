import { flushSync } from 'react-dom';
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const currentPath = (): string => window.location.pathname;

export function usePath(): string {
  return useSyncExternalStore(subscribe, currentPath);
}

/** Go to a page without a reload. `replace` swaps the history entry (redirects). */
export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  flushSync(() => {
    listeners.forEach((listener) => listener());
  });
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
