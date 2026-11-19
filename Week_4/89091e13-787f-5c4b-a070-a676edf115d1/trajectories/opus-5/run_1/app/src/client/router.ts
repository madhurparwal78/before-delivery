import { Identity, Workspace } from './api.js';
import { LiveEvent } from '../shared/live.js';

export interface PageContext {
  main: HTMLElement;
  networkUpdates: HTMLElement;
  workspace: Workspace;
  identity: Identity;
  params: Record<string, string>;
  subscribe: (handler: (event: LiveEvent) => void) => void;
  refresh: () => void;
}

type Renderer = (pathname: string) => Promise<void>;

let renderer: Renderer | null = null;

export function navigate(path: string): void {
  if (path === window.location.pathname + window.location.search) return;
  window.history.pushState({}, '', path);
  void renderer?.(window.location.pathname);
}

export function startRouter(render: Renderer): void {
  renderer = render;
  window.addEventListener('popstate', () => {
    void render(window.location.pathname);
  });
  document.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest('a');
    if (!target) return;
    const href = target.getAttribute('href');
    if (!href || !href.startsWith('/') || target.hasAttribute('download')) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  });
  void render(window.location.pathname);
}
