import { el, type statusRegion } from './dom.js';

/**
 * The app's router. Navigation between signed-in pages happens inside the
 * single page, with no full reload; Back returns to the previous page.
 */

export type Route =
  | { page: 'sign-in' }
  | { page: 'closet' }
  | { page: 'trips' }
  | { page: 'imports'; openDialog?: boolean }
  | { page: 'settings' }
  | { page: 'workspace'; listId: string }
  | { page: 'share'; token: string };

type Handler = (route: Route) => void | Promise<void>;

let handler: Handler | null = null;

export function parsePath(pathname: string): Route {
  if (pathname === '/sign-in') return { page: 'sign-in' };
  if (pathname === '/closet') return { page: 'closet' };
  if (pathname === '/imports') return { page: 'imports' };
  if (pathname === '/settings') return { page: 'settings' };
  if (pathname === '/trips' || pathname === '/') return { page: 'trips' };
  const listMatch = /^\/lists\/([^/]+)$/.exec(pathname);
  if (listMatch !== null) return { page: 'workspace', listId: listMatch[1]! };
  const shareMatch = /^\/s\/([^/]+)$/.exec(pathname);
  if (shareMatch !== null) return { page: 'share', token: shareMatch[1]! };
  return { page: 'trips' };
}

export function installRouter(onRoute: Handler): void {
  handler = onRoute;
  window.addEventListener('popstate', () => {
    void dispatch(parsePath(window.location.pathname));
  });
  void dispatch(parsePath(window.location.pathname));
}

async function dispatch(route: Route): Promise<void> {
  if (handler !== null) await handler(route);
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void dispatch(parsePath(path));
}

export function currentPath(): string {
  return window.location.pathname;
}
