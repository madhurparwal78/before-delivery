import { api } from './api.js';
import { aDialogIsOpen } from './dialog.js';
import { screenSlide } from './motion.js';
import { Shell } from './shell.js';
import { renderCapture } from './screens/capture.js';
import { renderLanding } from './screens/landing.js';
import { renderLibrary } from './screens/library.js';
import { renderNotFound } from './screens/notFound.js';
import { renderReel } from './screens/reel.js';
import { renderReels } from './screens/reels.js';
import { renderReference } from './screens/reference.js';
import { renderSettings } from './screens/settings.js';
import { renderTrash } from './screens/trash.js';
import type { Screen, ScreenContext } from './screens/screen.js';

interface RouteDefinition {
  pattern: string[];
  render: (context: ScreenContext) => Screen;
  /** Where the screen sits in the Deck navigation, which decides the screen slide. */
  navIndex: number | null;
}

const ROUTES: RouteDefinition[] = [
  { pattern: [], render: renderLanding, navIndex: null },
  { pattern: ['library'], render: renderLibrary, navIndex: 0 },
  { pattern: ['capture'], render: renderCapture, navIndex: 1 },
  { pattern: ['references', ':id'], render: renderReference, navIndex: 0 },
  { pattern: ['reels'], render: renderReels, navIndex: 2 },
  { pattern: ['reels', ':id'], render: renderReel, navIndex: 2 },
  { pattern: ['trash'], render: renderTrash, navIndex: 3 },
  { pattern: ['settings'], render: renderSettings, navIndex: 4 },
];

const NOT_FOUND: RouteDefinition = { pattern: [], render: renderNotFound, navIndex: null };

const root = document.getElementById('app');
if (!root) throw new Error('the app root is missing');
const shell = new Shell(root);

let current: Screen | null = null;
let currentNavIndex: number | null = null;
let slideFromNavigation = false;

function match(pathname: string): { route: RouteDefinition; params: Record<string, string> } {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, part] of route.pattern.entries()) {
      const segment = segments[index]!;
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segment);
      else if (part !== segment) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return { route: NOT_FOUND, params: {} };
}

function navigate(
  path: string,
  options: { replace?: boolean; fromNavigation?: boolean; quiet?: boolean } = {},
): void {
  if (options.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  if (options.quiet) return;
  slideFromNavigation = options.fromNavigation === true;
  render();
}

function render(): void {
  current?.destroy();
  shell.clearDeckStatus();
  shell.clearAnnouncer();
  const url = new URL(window.location.href);
  const { route, params } = match(url.pathname);
  shell.showNavigation(route.navIndex !== null);
  shell.main.replaceChildren();
  current = route.render({ shell, params, search: url.searchParams, navigate });
  if (slideFromNavigation && currentNavIndex !== null && route.navIndex !== null) {
    screenSlide(shell.main, route.navIndex >= currentNavIndex ? 1 : -1);
  }
  currentNavIndex = route.navIndex;
  slideFromNavigation = false;
}

function internalLink(target: EventTarget | null): HTMLAnchorElement | null {
  const anchor = (target as HTMLElement | null)?.closest('a');
  if (!anchor) return null;
  const href = anchor.getAttribute('href');
  if (!href || !href.startsWith('/')) return null;
  if (anchor.hasAttribute('download') || anchor.target === '_blank') return null;
  return anchor;
}

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const anchor = internalLink(event.target);
  if (!anchor) return;
  event.preventDefault();
  navigate(anchor.getAttribute('href')!, { fromNavigation: shell.nav.contains(anchor) });
});

window.addEventListener('popstate', () => {
  slideFromNavigation = false;
  render();
});

/** The bracket shortcuts do nothing while a text field has focus or a dialog is open. */
document.addEventListener('keydown', (event) => {
  if (event.key !== '[' && event.key !== ']') return;
  if (aDialogIsOpen()) return;
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  ) {
    return;
  }
  if (shell.field.handleShortcut(event.key)) event.preventDefault();
});

void api
  .settings()
  .then((settings) => shell.setUnit(settings.unit))
  .catch(() => undefined);
shell.startStatusPolling();
render();
