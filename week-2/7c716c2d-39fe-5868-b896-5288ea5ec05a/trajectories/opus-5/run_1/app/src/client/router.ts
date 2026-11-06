export type Route = { path: string; segments: string[]; query: URLSearchParams; search: string };

type Listener = (route: Route) => void;

const listeners = new Set<Listener>();

export function currentRoute(): Route {
  const url = new URL(window.location.href);
  return {
    path: url.pathname,
    segments: url.pathname.split('/').filter((part) => part !== ''),
    query: url.searchParams,
    search: url.search,
  };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = new URL(to, window.location.origin);
  const same = target.pathname + target.search === window.location.pathname + window.location.search;
  if (options.replace === true) window.history.replaceState({}, '', target);
  else if (!same) window.history.pushState({}, '', target);
  else window.history.replaceState({}, '', target);
  announce();
}

/** Rewrites the address without a new history entry, for corrected filters. */
export function rewrite(to: string): void {
  const target = new URL(to, window.location.origin);
  window.history.replaceState({}, '', target);
}

export function onRouteChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  const route = currentRoute();
  for (const listener of [...listeners]) listener(route);
}

export function startRouter(): void {
  window.addEventListener('popstate', announce);
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (anchor === null || anchor === undefined) return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/') || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
}
