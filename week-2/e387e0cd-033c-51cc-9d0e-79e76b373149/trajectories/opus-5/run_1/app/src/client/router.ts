/** The client router: every published route shows the same screen when opened directly. */

export type Cleanup = () => void;

export interface RouteContext {
  readonly params: Readonly<Record<string, string>>;
  readonly url: URL;
}

export type Renderer = (host: HTMLElement, context: RouteContext) => Promise<Cleanup>;

interface Entry {
  readonly pattern: readonly string[];
  readonly render: Renderer;
}

const entries: Entry[] = [];
let fallback: Renderer | null = null;
let host: HTMLElement | null = null;
let cleanup: Cleanup | null = null;
let generation = 0;

export function route(pattern: string, render: Renderer): void {
  entries.push({ pattern: pattern.split('/').filter((part) => part !== ''), render });
}

export function fallbackRoute(render: Renderer): void {
  fallback = render;
}

function match(pathname: string): { render: Renderer; params: Record<string, string> } | null {
  const segments = pathname.split('/').filter((part) => part !== '');
  for (const entry of entries) {
    if (entry.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let fits = true;
    for (let index = 0; index < entry.pattern.length; index += 1) {
      const piece = entry.pattern[index];
      if (piece.startsWith(':')) {
        params[piece.slice(1)] = decodeURIComponent(segments[index]);
        continue;
      }
      if (piece !== segments[index]) {
        fits = false;
        break;
      }
    }
    if (fits) return { render: entry.render, params };
  }
  return null;
}

export async function show(): Promise<void> {
  if (host === null) return;
  generation += 1;
  const mine = generation;
  if (cleanup !== null) {
    cleanup();
    cleanup = null;
  }
  const url = new URL(window.location.href);
  const found = match(url.pathname);
  const render = found === null ? fallback : found.render;
  if (render === null) return;
  while (host.firstChild !== null) host.firstChild.remove();
  const next = await render(host, { params: found === null ? {} : found.params, url });
  if (mine !== generation) {
    next();
    return;
  }
  cleanup = next;
  const level1 = host.querySelector<HTMLElement>('h1');
  level1?.focus();
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (options.replace === true) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void show();
}

/** Keeps the address in step with typing without adding history entries. */
export function replaceQuery(search: string): void {
  window.history.replaceState({}, '', `${window.location.pathname}${search}`);
}

export function pushQuery(search: string): void {
  window.history.pushState({}, '', `${window.location.pathname}${search}`);
}

export function start(mount: HTMLElement): void {
  host = mount;
  window.addEventListener('popstate', () => {
    void show();
  });
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (anchor === null || anchor === undefined) return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/') || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  void show();
}
