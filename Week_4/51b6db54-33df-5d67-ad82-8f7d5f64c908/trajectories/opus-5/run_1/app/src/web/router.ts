export type Page = () => Promise<HTMLElement> | HTMLElement;

interface RouteEntry {
  pattern: RegExp;
  page: (params: string[]) => Promise<HTMLElement> | HTMLElement;
}

const routes: RouteEntry[] = [];
let host: HTMLElement | null = null;
let leave: (() => void) | null = null;

export function route(
  pattern: RegExp,
  page: (params: string[]) => Promise<HTMLElement> | HTMLElement,
): void {
  routes.push({ pattern, page });
}

export function onLeave(work: () => void): void {
  leave = work;
}

export async function render(): Promise<void> {
  if (host === null) return;
  leave?.();
  leave = null;
  const path = window.location.pathname;
  for (const entry of routes) {
    const match = path.match(entry.pattern);
    if (match === null) continue;
    const page = await entry.page(match.slice(1));
    host.replaceChildren(page);
    return;
  }
  host.replaceChildren(document.createTextNode('That page is not here'));
}

export function go(path: string): void {
  if (path === window.location.pathname) {
    void render();
    return;
  }
  window.history.pushState({}, '', path);
  void render();
}

export function startRouter(mount: HTMLElement): void {
  host = mount;
  window.addEventListener('popstate', () => void render());
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest('a');
    if (link === null || link === undefined) return;
    const href = link.getAttribute('href');
    if (href === null || !href.startsWith('/') || link.hasAttribute('download')) return;
    event.preventDefault();
    go(href);
  });
  void render();
}
