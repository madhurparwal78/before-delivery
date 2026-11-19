export interface Route {
  readonly name: 'home' | 'campaign' | 'studio' | 'editor' | 'pledges' | 'fix' | 'notFound';
  readonly id: string;
}

export function readRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home', id: '' };
  if (pathname === '/studio') return { name: 'studio', id: '' };
  if (pathname === '/pledges') return { name: 'pledges', id: '' };
  const campaign = /^\/campaigns\/([^/]+)$/.exec(pathname);
  if (campaign) return { name: 'campaign', id: decodeURIComponent(campaign[1] as string) };
  const editor = /^\/studio\/campaigns\/([^/]+)$/.exec(pathname);
  if (editor) return { name: 'editor', id: decodeURIComponent(editor[1] as string) };
  const fix = /^\/fix\/([^/]+)$/.exec(pathname);
  if (fix) return { name: 'fix', id: decodeURIComponent(fix[1] as string) };
  return { name: 'notFound', id: '' };
}

export interface NavigateOptions {
  /** Set when the destination should open with its "Change pledge" control focused. */
  readonly focusChange?: boolean;
}

type Handler = (route: Route, options: NavigateOptions) => void;
let handler: Handler = () => undefined;

export function startRouter(onRoute: Handler): void {
  handler = onRoute;
  window.addEventListener('popstate', () => handler(readRoute(window.location.pathname), {}));
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (anchor === null || anchor === undefined) return;
    const href = anchor.getAttribute('href');
    if (href === null || !href.startsWith('/') || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  handler(readRoute(window.location.pathname), {});
}

export function navigate(path: string, options: NavigateOptions = {}): void {
  if (path !== window.location.pathname) window.history.pushState(null, '', path);
  handler(readRoute(window.location.pathname), options);
}
