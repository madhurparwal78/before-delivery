type Renderer = (root: HTMLElement, params: Record<string, string>) => void | Promise<void>;

interface Route {
  pattern: RegExp;
  keys: string[];
  render: Renderer;
}

const routes: Route[] = [];

export function addRoute(path: string, render: Renderer): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path
      .split('/')
      .map((segment) => {
        if (!segment.startsWith(':')) return segment;
        keys.push(segment.slice(1));
        return '([^/]+)';
      })
      .join('/')}$`,
  );
  routes.push({ pattern, keys, render });
}

function root(): HTMLElement {
  const node = document.getElementById('root');
  if (!node) throw new Error('missing root element');
  return node;
}

export function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

let teardown: (() => void) | null = null;

/** A screen that holds live connections registers how to close them. */
export function registerTeardown(close: () => void): void {
  teardown = close;
}

export async function render(): Promise<void> {
  if (teardown) {
    const close = teardown;
    teardown = null;
    close();
  }
  const path = currentPath();
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? '');
    });
    await route.render(root(), params);
    return;
  }
  root().textContent = 'Not found.';
}

export function navigate(path: string): void {
  if (path === currentPath()) {
    void render();
    return;
  }
  window.history.pushState({}, '', path);
  void render();
}

export function startRouter(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !href.startsWith('/') || anchor.hasAttribute('download') || anchor.target) return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => void render());
  void render();
}
