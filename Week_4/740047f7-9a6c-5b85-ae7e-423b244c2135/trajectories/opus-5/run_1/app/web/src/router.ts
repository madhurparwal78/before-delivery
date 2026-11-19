export interface PageHandle {
  destroy(): void;
}

export type PageFactory = (container: HTMLElement) => PageHandle | Promise<PageHandle>;

type Route = { pattern: RegExp; factory: (params: string[]) => PageFactory };

const routes: Route[] = [];
let current: PageHandle | null = null;
let container: HTMLElement | null = null;
let onRoute: ((path: string) => void) | null = null;

export function defineRoute(
  pattern: RegExp,
  factory: (params: string[]) => PageFactory,
): void {
  routes.push({ pattern, factory });
}

export function startRouter(host: HTMLElement, hook: (path: string) => void): void {
  container = host;
  onRoute = hook;
  window.addEventListener("popstate", () => void render());
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("/") || anchor.hasAttribute("download")) return;
    if (href.startsWith("/api/")) return;
    event.preventDefault();
    navigate(href);
  });
  void render();
}

export function navigate(href: string): void {
  const here = window.location.pathname + window.location.search + window.location.hash;
  if (href !== here) window.history.pushState({}, "", href);
  void render();
}

/// The console rewrites the address by replacing the current history entry,
/// never by adding one.
export function replaceAddress(href: string): void {
  if (href !== window.location.pathname + window.location.search) {
    window.history.replaceState({}, "", href);
  }
}

async function render(): Promise<void> {
  if (!container) return;
  current?.destroy();
  current = null;
  while (container.firstChild) container.removeChild(container.firstChild);
  const path = window.location.pathname;
  onRoute?.(path);
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    const factory = route.factory(match.slice(1));
    current = await factory(container);
    return;
  }
}
