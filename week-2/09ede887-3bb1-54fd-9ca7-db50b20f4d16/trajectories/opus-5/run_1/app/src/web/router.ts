export interface Page {
  readonly element: HTMLElement;
  mount?: () => void;
  refresh?: () => Promise<void>;
  unmount?: () => void;
  /** Returns false to hold the visitor here; call `proceed` to let them go. */
  confirmLeave?: (proceed: () => void) => boolean;
}

export interface Route {
  readonly path: string;
  readonly search: string;
  readonly previousPath: string | null;
  readonly popped: boolean;
  readonly state: Readonly<Record<string, unknown>>;
}

type Renderer = (route: Route) => Page;

let render: Renderer = () => ({ element: document.createElement('div') });
let host: HTMLElement | null = null;
let current: Page | null = null;
let previousPath: string | null = null;
let currentHref = '';
let skipGuard = false;

export function start(root: HTMLElement, renderer: Renderer): void {
  host = root;
  render = renderer;
  history.scrollRestoration = 'manual';
  window.addEventListener('popstate', () => {
    if (!skipGuard && current?.confirmLeave !== undefined) {
      const from = currentHref;
      const held = !current.confirmLeave(() => {
        skipGuard = true;
        history.back();
      });
      if (held) {
        // Put the entry the visitor just left back on top while they decide.
        history.pushState(history.state, '', from);
        return;
      }
    }
    skipGuard = false;
    draw(true);
  });
  document.addEventListener('click', interceptLink);
  draw(false);
}

function interceptLink(event: MouseEvent): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  const anchor = (event.target as Element | null)?.closest('a');
  if (anchor === null || anchor === undefined) return;
  const href = anchor.getAttribute('href');
  if (href === null || anchor.hasAttribute('download') || anchor.target === '_blank') return;
  if (!href.startsWith('/') || href.startsWith('//') || href.startsWith('/api/')) return;
  event.preventDefault();
  navigate(href);
}

export function navigate(href: string, options: { readonly replace?: boolean } = {}): void {
  const target = new URL(href, location.origin);
  if (target.hash !== '' && target.pathname === location.pathname && target.search === location.search) {
    history.pushState({ ...(history.state as object | null) }, '', href);
    document.querySelector(target.hash)?.scrollIntoView({ block: 'start' });
    return;
  }
  if (current?.confirmLeave !== undefined) {
    const held = !current.confirmLeave(() => {
      skipGuard = true;
      navigate(href, options);
      skipGuard = false;
    });
    if (held) return;
  }
  rememberScroll();
  if (options.replace === true) history.replaceState({}, '', href);
  else history.pushState({}, '', href);
  draw(false);
}

/** A filter change: one history entry, no page teardown. */
export function pushFilters(href: string, state: Readonly<Record<string, unknown>> = {}): void {
  rememberScroll();
  history.pushState({ ...state }, '', href);
}

export function replaceState(state: Readonly<Record<string, unknown>>): void {
  history.replaceState({ ...(history.state as object | null), ...state }, '');
}

function rememberScroll(): void {
  history.replaceState({ ...(history.state as object | null), scrollY: window.scrollY }, '');
}

export function currentRoute(popped = false): Route {
  return {
    path: location.pathname,
    search: location.search,
    previousPath,
    popped,
    state: (history.state as Record<string, unknown> | null) ?? {},
  };
}

function draw(popped: boolean): void {
  if (host === null) return;
  const route = currentRoute(popped);
  current?.unmount?.();
  const page = render(route);
  current = page;
  host.replaceChildren(page.element);
  previousPath = route.path;
  currentHref = `${route.path}${route.search}`;
  page.mount?.();
  const kept = route.state['scrollY'];
  if (popped && typeof kept === 'number') window.scrollTo(0, kept);
  else if (!popped) window.scrollTo(0, 0);
}

/** Puts the window back where this history entry was left. */
export function restoreScroll(): void {
  const kept = (history.state as { scrollY?: unknown } | null)?.scrollY;
  if (typeof kept === 'number') window.scrollTo(0, kept);
}
