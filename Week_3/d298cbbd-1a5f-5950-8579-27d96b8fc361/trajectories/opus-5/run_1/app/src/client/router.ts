export interface Page {
  render(container: HTMLElement): void | Promise<void>;
  dispose?(): void;
}

type PageFactory = (params: Record<string, string>) => Page;

interface RoutePattern {
  readonly pattern: string;
  readonly factory: PageFactory;
}

const patterns: RoutePattern[] = [];
let fallback: PageFactory | null = null;
let current: Page | null = null;
let renderPage: (() => void) | null = null;

export function definePage(pattern: string, factory: PageFactory): void {
  patterns.push({ pattern, factory });
}

export function defineFallback(factory: PageFactory): void {
  fallback = factory;
}

function match(path: string): { factory: PageFactory; params: Record<string, string> } | null {
  for (const route of patterns) {
    const expected = route.pattern.split('/');
    const actual = path.split('/');
    if (expected.length !== actual.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < expected.length; i += 1) {
      const part = expected[i] as string;
      const value = actual[i] as string;
      if (part.startsWith(':')) {
        if (value === '') {
          ok = false;
          break;
        }
        params[part.slice(1)] = decodeURIComponent(value);
      } else if (part !== value) {
        ok = false;
        break;
      }
    }
    if (ok) return { factory: route.factory, params };
  }
  return null;
}

export function startRouter(container: () => HTMLElement, onNavigate: () => void): void {
  renderPage = (): void => {
    current?.dispose?.();
    current = null;
    onNavigate();
    const path = window.location.pathname;
    const found = match(path);
    const factory = found?.factory ?? fallback;
    if (!factory) return;
    const page = factory(found?.params ?? {});
    current = page;
    void page.render(container());
  };
  window.addEventListener('popstate', () => renderPage?.());
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const target = event.target as HTMLElement | null;
    const link = target?.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('/') || link.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  renderPage();
}

export function navigate(path: string): void {
  if (path !== window.location.pathname + window.location.search) {
    window.history.pushState(null, '', path);
  }
  renderPage?.();
}

export function replaceQuery(search: string): void {
  const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
  window.history.replaceState(null, '', url);
}
