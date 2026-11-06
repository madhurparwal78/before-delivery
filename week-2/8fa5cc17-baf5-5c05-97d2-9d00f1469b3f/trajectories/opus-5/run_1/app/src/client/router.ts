import { frame } from './frame';
import { animate, fadeIn } from './anim';
import { playTitleTransition } from './components/titletransition';
import { DAILY_REVEAL_MS } from '../shared/motion';
import { prefersReducedMotion } from './dom';

export type ScreenParams = { path: string; params: Record<string, string>; search: URLSearchParams };

export type Screen = {
  mount: (params: ScreenParams) => Promise<void>;
  unmount?: () => void;
};

export type RouteEntry = { pattern: string; screen: () => Screen };

let routes: RouteEntry[] = [];
let current: Screen | null = null;
let currentPathValue = '/';
let firstLoad = true;

export function registerRoutes(entries: RouteEntry[]): void {
  routes = entries;
}

function match(path: string): { entry: RouteEntry; params: Record<string, string> } | null {
  const parts = path.split('/').filter((part) => part.length > 0);
  for (const entry of routes) {
    const segments = entry.pattern.split('/').filter((part) => part.length > 0);
    if (segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let index = 0; index < segments.length; index += 1) {
      if (segments[index].startsWith(':')) {
        params[segments[index].slice(1)] = decodeURIComponent(parts[index]);
        continue;
      }
      if (segments[index] !== parts[index]) {
        ok = false;
        break;
      }
    }
    if (ok) return { entry, params };
  }
  return null;
}

export type NavigateOptions = { replace?: boolean; reveal?: boolean };

export function navigate(path: string, options: NavigateOptions = {}): void {
  if (options.replace === true) window.history.replaceState({}, '', path);
  else window.history.pushState({}, '', path);
  void render(path, options.reveal === true);
}

/** Moving to a daily note within the app reveals it from the left. */
export function playDailyReveal(main: HTMLElement): void {
  if (prefersReducedMotion()) {
    fadeIn(main);
    return;
  }
  animate(main, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], DAILY_REVEAL_MS);
}

export async function render(path: string, reveal: boolean): Promise<void> {
  currentPathValue = path;
  const url = new URL(path, window.location.origin);
  if (current !== null && current.unmount !== undefined) current.unmount();
  const matched = match(url.pathname);
  const notFound = routes.find((entry) => entry.pattern === '*');
  const entry = matched === null ? notFound : matched.entry;
  if (entry === undefined) return;
  current = entry.screen();
  const shouldReveal = reveal && !firstLoad;
  firstLoad = false;
  await current.mount({
    path: url.pathname,
    params: matched === null ? {} : matched.params,
    search: url.searchParams,
  });
  const heading = frame().main.querySelector('h1');
  if (shouldReveal) {
    playDailyReveal(frame().main);
    if (heading !== null) (heading as HTMLElement).focus();
  } else if (heading !== null) {
    playTitleTransition(heading as HTMLElement);
  }
  frame().updateReadingProgress();
}

export function startRouter(): void {
  window.addEventListener('popstate', () => {
    void render(window.location.pathname + window.location.search, false);
  });
  void render(window.location.pathname + window.location.search, false);
}
