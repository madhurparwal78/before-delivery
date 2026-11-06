/**
 * The router. Each page registers itself; navigation happens without a reload,
 * and the live refresh runs at least every five seconds while the tab shows.
 */

import { state } from './state.js';

export type Renderer = () => Promise<void>;

interface RouteEntry {
  pattern: RegExp;
  render: Renderer;
}

const routes: RouteEntry[] = [];

export function route(pattern: RegExp, render: Renderer): void {
  routes.push({ pattern, render });
}

export async function renderCurrent(): Promise<void> {
  const path = location.pathname;
  state.refresh = null;
  for (const entry of routes) {
    if (entry.pattern.test(path)) {
      await entry.render();
      return;
    }
  }
  const { renderNotFound } = await import('./pages/notfound.js');
  await renderNotFound();
}

/** Navigate within the app without reloading the document. */
export function navigate(path: string): void {
  if (path.startsWith('/#')) {
    // An anchor link on the home page scrolls to its chapter.
    document.getElementById(path.slice(2))?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  history.pushState({}, '', path);
  void renderCurrent();
}

export function bindNavigation(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as HTMLElement).closest('a');
    if (anchor === null) return;
    const href = anchor.getAttribute('href');
    if (href === null || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) return;
    if (anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigate(href);
  });
  window.addEventListener('popstate', () => {
    void renderCurrent();
  });
}

/** Live refresh: at least every five seconds, and again when the tab regains focus. */
export function startRefreshLoop(): void {
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void refreshQuietly();
  }, 4000);
  window.addEventListener('focus', () => {
    void refreshQuietly();
  });
}

async function refreshQuietly(): Promise<void> {
  if (state.refresh === null) return;
  await state.refresh();
}
