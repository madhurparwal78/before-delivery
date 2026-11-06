import { closeAllDialogs } from './dialog.js';
import { clear, el } from './dom.js';
import { clearAnnouncements } from './live.js';
import { restoreForm } from './session.js';

export interface RouteContext {
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
}

export type Cleanup = () => void;
export type Screen = (host: HTMLElement, context: RouteContext) => Promise<Cleanup | void>;

interface Route {
  readonly segments: readonly string[];
  readonly screen: Screen;
}

const routes: Route[] = [];
let cleanup: Cleanup | null = null;
let notFoundScreen: Screen | null = null;
let beforeLeave: (() => boolean) | null = null;

export function route(pattern: string, screen: Screen): void {
  routes.push({ segments: pattern.split('/').slice(1), screen });
}

export function setNotFound(screen: Screen): void {
  notFoundScreen = screen;
}

/** Lets a screen stop a navigation, for the unsaved-changes dialog. */
export function guardLeave(guard: (() => boolean) | null): void {
  beforeLeave = guard;
}

function match(path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').slice(1);
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of candidate.segments.entries()) {
      if (segment.startsWith(':')) {
        if (parts[index] === '') {
          matched = false;
          break;
        }
        params[segment.slice(1)] = decodeURIComponent(parts[index]);
      } else if (segment !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

export async function render(): Promise<void> {
  const host = document.getElementById('app') as HTMLElement;
  const url = new URL(window.location.href);
  const path =
    url.pathname.length > 1 && url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  cleanup?.();
  cleanup = null;
  guardLeave(null);
  closeAllDialogs();
  clearAnnouncements();
  clear(host);
  const found = match(path);
  const context: RouteContext = {
    path,
    params: found === null ? {} : found.params,
    query: url.searchParams,
  };
  const screen = found === null ? notFoundScreen : found.route.screen;
  if (screen === null) return;
  const loader = el(
    'div',
    { class: 'loader', role: 'status', 'aria-label': 'Loading' },
    el('span', { class: 'loader-dot' }),
    el('span', { class: 'loader-dot' }),
    el('span', { class: 'loader-dot' }),
  );
  host.appendChild(loader);
  const result = await screen(host, context);
  loader.remove();
  cleanup = typeof result === 'function' ? result : null;
  restoreForm();
  window.scrollTo(0, 0);
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === `${window.location.pathname}${window.location.search}`) return;
  if (beforeLeave !== null && !beforeLeave()) return;
  if (options.replace === true) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render();
}

/** Changes the address without rebuilding the screen, for in-place filtering. */
export function pushPath(path: string): void {
  window.history.pushState({}, '', path);
}

export function replacePath(path: string): void {
  window.history.replaceState({}, '', path);
}

export function link(label: string, path: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
  return el(
    'a',
    {
      ...attributes,
      href: path,
      onclick: (event: Event) => {
        const mouse = event as MouseEvent;
        if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.button !== 0) return;
        event.preventDefault();
        navigate(path);
      },
    },
    label,
  );
}

export function startRouter(): void {
  window.addEventListener('popstate', () => {
    void render();
  });
  void render();
}
