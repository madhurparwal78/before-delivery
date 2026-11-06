import { renderShell } from './shell.js';
import { stopPolling } from './store.js';
import { clear, resetBindings } from './ui.js';

export type Route = {
  pattern: string;
  render: (main: HTMLElement, params: Record<string, string>) => void | Promise<void>;
};

const routes: Route[] = [];
let notFound: Route['render'] | null = null;

export function addRoute(pattern: string, render: Route['render']): void {
  routes.push({ pattern, render });
}

export function setNotFound(render: Route['render']): void {
  notFound = render;
}

function match(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/').filter(Boolean);
  const actual = path.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const segment = expected[index] as string;
    const value = actual[index] as string;
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
    else if (segment !== value) return null;
  }
  return params;
}

export function navigate(href: string, options: { replace?: boolean } = {}): void {
  const url = new URL(href, location.origin);
  if (options.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  void renderCurrent();
}

export async function renderCurrent(): Promise<void> {
  stopPolling();
  resetBindings();
  const path = location.pathname;
  const app = document.getElementById('app');
  if (!app) return;
  clear(app);
  const { root, main } = renderShell(path);
  app.append(root);
  for (const route of routes) {
    const params = match(route.pattern, path);
    if (params) {
      await route.render(main, params);
      return;
    }
  }
  if (notFound) await notFound(main, {});
}

export function installHistory(): void {
  window.addEventListener('popstate', () => void renderCurrent());
}
