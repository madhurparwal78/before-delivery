/** The address is the app's state: one page per path, and filters live in the query. */

import { closeAllLayers } from './dom';

export interface Page {
  node: HTMLElement;
  /** Called when the address changes within the same page, including Back and Forward. */
  onAddress?: (url: URL) => void;
  destroy?: () => void;
}

export type PageKind = 'landing' | 'finder' | 'hold' | 'shared' | 'console';

export interface PageDefinition {
  kind: PageKind;
  match: (pathname: string) => boolean;
  create: (url: URL) => Page;
}

let definitions: PageDefinition[] = [];
let current: { kind: PageKind; page: Page } | null = null;
let root: HTMLElement;

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const url = new URL(path, window.location.origin);
  if (options.replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  render(url);
}

/** Rewrites the address without adding a history entry or re-rendering. */
export function rewriteAddress(path: string): void {
  window.history.replaceState(null, '', new URL(path, window.location.origin));
}

export function pushAddress(path: string): void {
  window.history.pushState(null, '', new URL(path, window.location.origin));
}

function render(url: URL): void {
  const definition = definitions.find((candidate) => candidate.match(url.pathname));
  if (!definition) return;
  if (current && current.kind === definition.kind && current.page.onAddress) {
    current.page.onAddress(url);
    return;
  }
  current?.page.destroy?.();
  closeAllLayers();
  root.replaceChildren();
  const page = definition.create(url);
  current = { kind: definition.kind, page };
  root.append(page.node);
}

export function startRouter(pages: PageDefinition[], appRoot: HTMLElement): void {
  definitions = pages;
  root = appRoot;
  window.addEventListener('popstate', () => render(new URL(window.location.href)));
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/') || anchor.hasAttribute('download') || anchor.target === '_blank') return;
    event.preventDefault();
    navigate(href);
  });
  render(new URL(window.location.href));
}
