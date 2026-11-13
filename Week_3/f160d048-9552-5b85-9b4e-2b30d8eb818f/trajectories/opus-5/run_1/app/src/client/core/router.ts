export type Cleanup = () => void;

export interface PageContext {
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

export type PageRender = (container: HTMLElement, ctx: PageContext) => Promise<Cleanup | void> | Cleanup | void;

interface Route {
  segments: string[];
  render: PageRender;
}

const routes: Route[] = [];
let notFound: PageRender = () => undefined;
let current: Cleanup | null = null;
let container: HTMLElement | null = null;
let beforeRender: (() => void) | null = null;

export function route(pattern: string, render: PageRender): void {
  routes.push({ segments: pattern.split('/').filter((part) => part.length > 0), render });
}

export function setNotFound(render: PageRender): void {
  notFound = render;
}

function match(pathname: string): { render: PageRender; params: Record<string, string> } {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of candidate.segments.entries()) {
      const value = parts[index] as string;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
      else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { render: candidate.render, params };
  }
  return { render: notFound, params: {} };
}

let loadingFrame: (() => HTMLElement) | null = null;

async function renderCurrent(): Promise<void> {
  if (!container) return;
  current?.();
  current = null;
  beforeRender?.();
  const frame = loadingFrame?.() ?? null;
  container.replaceChildren(...(frame ? [frame] : []));
  window.scrollTo({ top: 0 });
  const url = new URL(window.location.href);
  const { render, params } = match(url.pathname);
  /** The page builds in its own host so the loading frame never shifts it. */
  const host = document.createElement('div');
  const cleanup = await render(host, { params, query: url.searchParams, path: url.pathname });
  container.replaceChildren(host);
  current = typeof cleanup === 'function' ? cleanup : null;
}

export function navigate(href: string, options: { replace?: boolean } = {}): void {
  const url = new URL(href, window.location.origin);
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  void renderCurrent();
}

/** Keeps the filters in the URL without a reload. */
export function replaceQuery(query: URLSearchParams): void {
  const url = new URL(window.location.href);
  url.search = query.toString();
  window.history.replaceState(null, '', url);
}

export function startRouter(host: HTMLElement, onBeforeRender: () => void, frame: () => HTMLElement): void {
  container = host;
  beforeRender = onBeforeRender;
  loadingFrame = frame;
  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest('a');
    if (!(target instanceof HTMLAnchorElement)) return;
    if (target.target === '_blank' || target.hasAttribute('download') || event.metaKey || event.ctrlKey) return;
    const url = new URL(target.href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  window.addEventListener('popstate', () => void renderCurrent());
  void renderCurrent();
}
