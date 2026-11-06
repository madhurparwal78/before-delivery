// Client navigation over the History API. A page may take over address changes within itself (the quiz).
import { matchPage, type Page } from "../shared/pages.ts";

export interface PageContext {
  main: HTMLElement;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Called instead of a re-render when the address changes but stays on this page. */
  onLocation(handler: () => void): void;
  /** Called when the page is left. */
  onLeave(handler: () => void): void;
}

type PageRender = (ctx: PageContext) => void | Promise<void>;

let routes: Partial<Record<Page, PageRender>> & { notFound?: PageRender } = {};
let main: HTMLElement | null = null;
let current: { page: Page | null; within: (() => void) | null; leave: (() => void)[] } = { page: null, within: null, leave: [] };

export function startRouter(target: HTMLElement, table: typeof routes): void {
  main = target;
  routes = table;
  window.addEventListener("popstate", () => void render(false));
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || link.target || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    event.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
  void render(false);
}

export function navigate(path: string, options: { replace?: boolean; state?: Record<string, unknown> } = {}): void {
  if (options.replace) history.replaceState(options.state ?? null, "", path);
  else history.pushState(options.state ?? null, "", path);
  void render(true);
}

/** Sends a visitor to sign in and back to the current page afterwards. */
export function toSignIn(): void {
  navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
}

async function render(moved: boolean): Promise<void> {
  if (!main) return;
  const found = matchPage(location.pathname);
  const page = found?.page ?? null;
  if (!moved && page && page === current.page && current.within) {
    current.within();
    return;
  }
  for (const leave of current.leave) leave();
  current = { page, within: null, leave: [] };
  const state = current;
  main.replaceChildren();
  const ctx: PageContext = {
    main,
    params: found?.params ?? {},
    query: new URLSearchParams(location.search),
    onLocation: (handler) => {
      state.within = handler;
    },
    onLeave: (handler) => {
      state.leave.push(handler);
    },
  };
  const renderPage = (page ? routes[page] : undefined) ?? routes.notFound;
  if (moved) window.scrollTo(0, 0);
  await renderPage?.(ctx);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  if (moved && !location.hash) main.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
}
