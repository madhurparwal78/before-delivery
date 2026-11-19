// A tiny history router: `navigate()` changes the address, `useLocation()` reads it, `matchRoute()` picks the page.
import { useMemo, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import type { ComponentType } from 'react';

export type Params = Record<string, string>;

export interface Route {
  /** `/workbooks/:id/sheets/:sheet` — a `:name` segment matches one path segment and is passed to the page */
  pattern: string;
  page: ComponentType<{ params: Params }>;
}

interface Location {
  path: string;
  query: URLSearchParams;
  /** path and query, as typed in the address bar */
  href: string;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

window.addEventListener('popstate', notify);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => {
    const url = new URL(href, window.location.origin);
    return { path: url.pathname, query: url.searchParams, href };
  }, [href]);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.scrollTo(0, 0);
  flushSync(notify);
}

/** Where a signed-out visitor should land to come back to `href`. */
export function signInPath(href: string): string {
  return `/signin?next=${encodeURIComponent(href)}`;
}

/** The `next` parameter of the sign-in page, accepted only when it is a path on this site. */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

export function matchRoute(routes: readonly Route[], path: string): { route: Route; params: Params } | null {
  const segments = path.split('/').filter(Boolean);
  for (const route of routes) {
    const pattern = route.pattern.split('/').filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Params = {};
    const hit = pattern.every((part, index) => {
      const segment = segments[index] ?? '';
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segment);
        return true;
      }
      return part === segment;
    });
    if (hit) return { route, params };
  }
  return null;
}
