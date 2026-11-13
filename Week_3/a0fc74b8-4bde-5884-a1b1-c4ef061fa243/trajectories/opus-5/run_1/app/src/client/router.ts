export type RouteHandler = () => void;

let handler: RouteHandler = () => undefined;

export const setRouteHandler = (next: RouteHandler): void => {
  handler = next;
};

export const navigate = (path: string): void => {
  if (`${window.location.pathname}${window.location.search}` === path) return;
  window.history.pushState(null, '', path);
  handler();
};

export const startRouter = (): void => {
  window.addEventListener('popstate', () => handler());
  document.addEventListener('click', (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/') || anchor.hasAttribute('download')) return;
    if (href.startsWith('//')) return;
    event.preventDefault();
    navigate(href);
  });
  handler();
};

/** A return path is followed only when it is a same-origin path. */
export const safeReturnPath = (raw: string | null): string => {
  if (raw === null || raw === '') return '/documents';
  if (!raw.startsWith('/')) return '/documents';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/documents';
  return raw;
};
