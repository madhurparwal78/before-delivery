// History-API router: one table of pages, client-side navigation for in-app links, focus moved to the page heading.
import { useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

type Route =
  | { page: 'landing' }
  | { page: 'signup' }
  | { page: 'check-inbox' }
  | { page: 'verify'; token: string }
  | { page: 'signin' }
  | { page: 'open' }
  | { page: 'drawings' }
  | { page: 'editor'; drawingId: string }
  | { page: 'link'; token: string }
  | { page: 'not-found' };

export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const segments = path.split('/').filter(Boolean);
  const [first, second] = segments;
  if (segments.length === 0) return { page: 'landing' };
  if (segments.length === 1) {
    if (first === 'signup') return { page: 'signup' };
    if (first === 'check-inbox') return { page: 'check-inbox' };
    if (first === 'signin') return { page: 'signin' };
    if (first === 'open') return { page: 'open' };
    if (first === 'drawings') return { page: 'drawings' };
  }
  if (segments.length === 2 && second) {
    const value = decodeURIComponent(second);
    if (first === 'verify') return { page: 'verify', token: value };
    if (first === 'd') return { page: 'editor', drawingId: value };
    if (first === 's') return { page: 'link', token: value };
  }
  return { page: 'not-found' };
}

const listeners = new Set<() => void>();
let headingFocusPending = false;

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener('popstate', notify);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = (): string => location.pathname + location.search;

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  headingFocusPending = true;
  notify();
}

/** True once after each in-app navigation; the app root uses it to move focus to the new page's heading. */
export function takeHeadingFocus(): boolean {
  const pending = headingFocusPending;
  headingFocusPending = false;
  return pending;
}

export function useLocation(): { pathname: string; search: URLSearchParams } {
  const current = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => {
    const url = new URL(current, location.origin);
    return { pathname: url.pathname, search: url.searchParams };
  }, [current]);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, target, ...rest }: LinkProps) {
  const handle = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || target) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} target={target} onClick={handle} {...rest} />;
}
