/**
 * Routing. The address bar is the only source of the screen and, on the board
 * and the shift sheet, of the kitchen day being shown.
 */

export type Cleanup = () => void;

export interface ScreenContext {
  root: HTMLElement;
  path: string;
  query: URLSearchParams;
}

export type Screen = (context: ScreenContext) => Cleanup | void;

let activeCleanup: Cleanup | null = null;
let resolve: (() => void) | null = null;

export function setRouteResolver(resolver: () => void): void {
  resolve = resolver;
}

/** Adds a history entry and renders. */
export function navigate(url: string): void {
  history.pushState(null, '', url);
  resolve?.();
}

/** Replaces the current entry without adding one, and renders. */
export function replace(url: string): void {
  history.replaceState(null, '', url);
  resolve?.();
}

/** Replaces the address only; the caller is already rendering. */
export function replaceAddressOnly(url: string): void {
  history.replaceState(null, '', url);
}

export function mount(screen: Screen, context: ScreenContext): void {
  activeCleanup?.();
  activeCleanup = null;
  context.root.replaceChildren();
  const cleanup = screen(context);
  activeCleanup = typeof cleanup === 'function' ? cleanup : null;
}

export function startRouting(): void {
  window.addEventListener('popstate', () => resolve?.());
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (
      !anchor ||
      anchor.dataset['external'] === 'true' ||
      anchor.target === '_blank' ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button !== 0
    ) {
      return;
    }
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/')) return;
    event.preventDefault();
    navigate(href);
  });
}
