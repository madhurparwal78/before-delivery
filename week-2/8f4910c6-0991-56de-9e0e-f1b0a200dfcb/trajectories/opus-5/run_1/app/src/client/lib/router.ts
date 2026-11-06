import { clear, el, focus } from './dom.js';
import { revealHeading, routeCover } from './motion.js';

export type RenderContext = {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
};

export type Chrome = 'public' | 'workspace' | 'plain';

export type ScreenResult = {
  node: HTMLElement;
  chrome: Chrome;
  /** Runs once the page is on screen and focused. */
  onMounted?: () => void;
  /** Runs when the screen is replaced, so timers stop. */
  onLeave?: () => void;
};

export type Screen = {
  pattern: string;
  render(ctx: RenderContext): Promise<ScreenResult>;
};

type Compiled = Screen & { parts: string[] };

const screens: Compiled[] = [];
let shell: ((result: ScreenResult) => HTMLElement) | null = null;
let notFoundScreen: Screen | null = null;
let leaveGuard: ((to: string, proceed: () => void) => void) | null = null;

export function registerScreens(list: Screen[]): void {
  for (const screen of list) {
    screens.push({ ...screen, parts: screen.pattern.split('/').filter((part) => part.length > 0) });
  }
}

export function setShell(render: (result: ScreenResult) => HTMLElement): void {
  shell = render;
}

export function setNotFound(screen: Screen): void {
  notFoundScreen = screen;
}

export function setLeaveGuard(guard: ((to: string, proceed: () => void) => void) | null): void {
  leaveGuard = guard;
}

function match(path: string): { screen: Screen; params: Record<string, string> } | null {
  const parts = path.split('/').filter((part) => part.length > 0);
  for (const screen of screens) {
    if (screen.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < parts.length; index += 1) {
      const pattern = screen.parts[index];
      if (pattern.startsWith(':')) {
        params[pattern.slice(1)] = decodeURIComponent(parts[index]);
        continue;
      }
      if (pattern !== parts[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return { screen, params };
  }
  return null;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const run = (): void => {
    if (options.replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    void render(false);
  };
  if (leaveGuard && to !== currentPath()) {
    leaveGuard(to, run);
    return;
  }
  run();
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

let renderToken = 0;
let mounted: ScreenResult | null = null;

export async function render(back: boolean): Promise<void> {
  const token = ++renderToken;
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const found = match(path);
  const screen = found?.screen ?? notFoundScreen;
  if (!screen || !shell) return;

  const isPublic = !path.startsWith('/workspace');
  const reveal = isPublic && document.querySelector('.page') !== null
    ? await routeCover(back)
    : null;
  const result = await screen.render({ path, params: found?.params ?? {}, query });
  if (token !== renderToken) {
    await reveal?.();
    return;
  }
  const root = document.getElementById('app');
  if (!root) return;
  mounted?.onLeave?.();
  mounted = result;
  clear(root);
  root.append(shell(result));
  window.scrollTo(0, 0);
  await reveal?.();

  const heading = result.node.querySelector<HTMLElement>('h1');
  if (heading) {
    const text = heading.textContent ?? '';
    if (heading.classList.contains('display')) revealHeading(heading);
    document.title = `${text} — Vesper & Rowe Talent`;
    focus(heading);
  }
  result.onMounted?.();
}

export function startRouter(): void {
  window.addEventListener('popstate', () => {
    setLeaveGuard(null);
    void render(true);
  });
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || anchor.hasAttribute('download')) return;
    if (anchor.getAttribute('target')) return;
    event.preventDefault();
    navigate(href);
  });
  void render(false);
}

export function pageHeading(text: string, options: { display?: boolean } = {}): HTMLElement {
  return el('h1', { class: options.display === false ? 'page-title' : 'page-title display', text });
}
