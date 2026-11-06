// History router. Screen changes move focus to the level-1 heading.
import { h } from './dom.js';

export interface Route { pattern: RegExp; name: string }

export interface ScreenContext {
  params: Record<string, string>;
  query: URLSearchParams;
  url: URL;
}

export type ScreenRenderer = (root: HTMLElement, ctx: ScreenContext) => Promise<void> | void;

export interface Screen { name: string; pattern: RegExp; render: ScreenRenderer }

export const screens: Screen[] = [];

export function registerScreen(name: string, pattern: RegExp, render: ScreenRenderer): void {
  screens.push({ name, pattern, render });
}

export function matchScreen(path: string): Screen | null {
  for (const screen of screens) {
    if (screen.pattern.test(path)) return screen;
  }
  return null;
}

export function navigate(path: string, replace = false): void {
  if (replace) {
    history.replaceState({}, '', path);
  } else {
    history.pushState({}, '', path);
  }
  void renderRoute();
}

export let currentRoot: HTMLElement | null = null;

export async function renderRoute(): Promise<void> {
  if (currentRoot === null) return;
  const { stopAllPolling } = await import('./state.js');
  stopAllPolling();
  closeAllPanelsOnNavigate();
  const path = location.pathname;
  const screen = matchScreen(path);
  const root = currentRoot;
  root.replaceChildren();
  const url = new URL(location.href);
  const params: Record<string, string> = {};
  if (screen !== null) {
    const match = screen.pattern.exec(path);
    if (match !== null && match.groups !== undefined) {
      for (const [key, value] of Object.entries(match.groups)) {
        if (value !== undefined) params[key] = value;
      }
    }
    await screen.render(root, { params, query: url.searchParams, url });
  } else {
    await renderNotFound(root);
  }
  const heading = root.querySelector('h1');
  if (heading !== null) {
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

function closeAllPanelsOnNavigate(): void {
  document.querySelectorAll('[data-panel-layer]').forEach((el) => el.remove());
  document.body.classList.remove('has-panel');
  document.querySelectorAll('body > *:not([data-panel-layer])').forEach((el) => {
    (el as HTMLElement).inert = false;
  });
}

let notFoundRenderer: ScreenRenderer | null = null;

export function setNotFoundRenderer(render: ScreenRenderer): void {
  notFoundRenderer = render;
}

async function renderNotFound(root: HTMLElement): Promise<void> {
  if (notFoundRenderer !== null) {
    await notFoundRenderer(root, { params: {}, query: new URLSearchParams(), url: new URL(location.href) });
  }
}

export function bootRouter(root: HTMLElement): void {
  currentRoot = root;
  window.addEventListener('popstate', () => {
    void renderRoute();
  });
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('a') === null) return;
    const link = target.closest('a') as HTMLAnchorElement;
    if (link.target !== '' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) return;
    if (href.startsWith('http')) {
      const url = new URL(href);
      if (url.origin !== location.origin) return;
    }
    e.preventDefault();
    navigate(link.getAttribute('href') ?? '/');
  });
}

export function link(path: string, attrs: Record<string, unknown> = {}, ...children: unknown[]): HTMLElement {
  return h('a', { href: path, ...attrs }, ...(children as never[]));
}
