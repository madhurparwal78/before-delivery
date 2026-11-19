export interface Screen {
  readonly node: HTMLElement;
  destroy?(): void;
}

type RouteHandler = (path: string, search: URLSearchParams) => void;

let handler: RouteHandler = () => undefined;

export const currentPath = (): string => window.location.pathname;

export const currentSearch = (): URLSearchParams => new URLSearchParams(window.location.search);

/** Console navigation changes the address bar without reloading the page. */
export const navigate = (target: string, options: { readonly replace?: boolean } = {}): void => {
  const url = new URL(target, window.location.origin);
  const same = url.pathname === window.location.pathname && url.search === window.location.search;
  if (options.replace === true) window.history.replaceState({}, '', url);
  else if (!same) window.history.pushState({}, '', url);
  handler(url.pathname, url.searchParams);
};

export const startRouter = (next: RouteHandler): void => {
  handler = next;
  window.addEventListener('popstate', () => handler(currentPath(), currentSearch()));
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (anchor === null || anchor === undefined) return;
    const href = anchor.getAttribute('href');
    if (href === null || href.startsWith('http') || anchor.target === '_blank') return;
    if (anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  handler(currentPath(), currentSearch());
};
