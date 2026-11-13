import { Page } from './shell';

export type PageFactory = (path: string, search: URLSearchParams) => Promise<Page>;

let resolver: ((path: string, search: URLSearchParams) => Promise<Page>) | null = null;
let mounter: ((page: Page) => void) | null = null;

export function installRouter(resolve: PageFactory, mount: (page: Page) => void): void {
  resolver = resolve;
  mounter = mount;
  window.addEventListener('popstate', () => {
    void render();
  });
}

export async function render(): Promise<void> {
  if (resolver === null || mounter === null) return;
  const url = new URL(window.location.href);
  const page = await resolver(url.pathname, url.searchParams);
  mounter(page);
}

export function navigate(path: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  void render();
}

/** Replaces the address in place, without a reload and without a history entry. */
export function replaceQuery(search: string): void {
  const next = `${window.location.pathname}${search === '' ? '' : `?${search}`}`;
  window.history.replaceState(null, '', next);
}
