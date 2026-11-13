import { resetPlateRhythm } from './plates.js';

export interface RouteContext {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type PageRender = (ctx: RouteContext) => void | Promise<void>;

interface Route {
  pattern: string;
  render: PageRender;
}

const routes: Route[] = [];
let notFound: PageRender = () => undefined;
let cleanup: (() => void) | null = null;

export function addRoute(pattern: string, render: PageRender): void {
  routes.push({ pattern, render });
}

export function setNotFound(render: PageRender): void {
  notFound = render;
}

/** Pages register work to undo when the next page takes over. */
export function onLeave(run: () => void): void {
  const previous = cleanup;
  cleanup = () => {
    previous?.();
    run();
  };
}

function match(path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    const expected = route.pattern.split('/').filter(Boolean);
    if (expected.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < expected.length; i += 1) {
      const token = expected[i] as string;
      const actual = parts[i] as string;
      if (token.startsWith(':')) params[token.slice(1)] = actual;
      else if (token !== actual) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function render(): void {
  const url = new URL(window.location.href);
  const found = match(url.pathname);
  const previous = cleanup;
  cleanup = null;
  previous?.();
  resetPlateRhythm();
  const ctx: RouteContext = {
    path: url.pathname,
    params: found?.params ?? {},
    query: url.searchParams,
  };
  void (found ? found.route.render(ctx) : notFound(ctx));
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  render();
}

/** Update the query of the current page without re-rendering it. */
export function replaceQuery(to: string): void {
  window.history.replaceState({}, '', to);
}

export function startRouter(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', render);
  render();
}
