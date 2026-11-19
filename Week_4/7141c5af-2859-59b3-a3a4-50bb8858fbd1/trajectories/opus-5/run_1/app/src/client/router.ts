/**
 * Moving between screens with no page move: the new screen is put in place,
 * focus goes to its level-one heading and the title changes with the route.
 * Pressing a case moves its drawing to the case page's hero as one element.
 */
import { DURATION, animate, reducedMotion } from './ui/motion.ts';
import { find, need } from './ui/dom.ts';

export type ScreenStart = (screen: string) => void;

let startScreen: ScreenStart = () => undefined;
let navigating = 0;

/** Where the reader was, so Back returns to the same place. */
interface Place {
  scroll: number;
  focusCase: string | null;
}

const places = new Map<string, Place>();

function placeKey(): string {
  return window.location.pathname + window.location.search;
}

function rememberPlace(focusCase: string | null = null): void {
  places.set(placeKey(), { scroll: window.scrollY, focusCase });
}

interface LoadedPage {
  title: string;
  screen: string;
  main: string;
  header: string;
}

async function loadPage(url: string): Promise<LoadedPage | null> {
  const response = await fetch(url, { credentials: 'same-origin', headers: { accept: 'text/html' } });
  const html = await response.text();
  if (response.redirected) {
    window.location.assign(response.url);
    return null;
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const main = parsed.getElementById('main');
  if (!main) {
    window.location.assign(url);
    return null;
  }
  const header = parsed.querySelector('header');
  return {
    title: parsed.title,
    screen: parsed.body.dataset.screen ?? '',
    main: main.innerHTML,
    header: header ? header.outerHTML : '',
  };
}

function applyPage(page: LoadedPage): void {
  document.title = page.title;
  const main = need('#main');
  main.innerHTML = page.main;

  const currentHeader = document.querySelector('header');
  if (page.header) {
    if (currentHeader) {
      const parsed = new DOMParser().parseFromString(page.header, 'text/html');
      const next = parsed.querySelector('header')!;
      // The header is kept where its kind has not changed, so nothing moves.
      if (currentHeader.className !== next.className) currentHeader.replaceWith(next);
      else currentHeader.innerHTML = next.innerHTML;
    }
  } else {
    currentHeader?.remove();
  }
  document.body.dataset.screen = page.screen;
}

/** Shows the loaded page and hands over to its screen. */
function settle(page: LoadedPage, focusTarget?: HTMLElement | null): void {
  applyPage(page);
  startScreen(page.screen);
  const heading = focusTarget ?? find<HTMLElement>('#page-heading') ?? find<HTMLElement>('h1');
  heading?.focus();
}

export async function navigate(url: string, options: { replace?: boolean; focusCase?: string } = {}): Promise<void> {
  const token = ++navigating;
  rememberPlace(options.focusCase ?? null);
  const page = await loadPage(url);
  if (!page || token !== navigating) return;
  if (options.replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
  window.scrollTo(0, 0);
  settle(page);
}

/**
 * The tile's drawing element is kept and becomes the hero, so during the move
 * the document holds exactly one element for that `data-case`.
 */
async function navigateCase(url: string, slug: string, drawing: HTMLElement): Promise<void> {
  const token = ++navigating;
  rememberPlace(slug);

  if (reducedMotion()) {
    const page = await loadPage(url);
    if (!page || token !== navigating) return;
    window.history.pushState({}, '', url);
    window.scrollTo(0, 0);
    settle(page);
    return;
  }

  const from = drawing.getBoundingClientRect();
  const kept = drawing;
  kept.style.zIndex = '40';

  const page = await loadPage(url);
  if (!page || token !== navigating) return;

  const main = need('#main');
  main.setAttribute('inert', '');
  window.history.pushState({}, '', url);
  applyPage(page);
  window.scrollTo(0, 0);

  const slot = find<HTMLElement>(`#main [data-part="case-drawing"][data-case="${slug}"]`);
  if (!slot) {
    main.removeAttribute('inert');
    settle(page);
    return;
  }
  slot.replaceWith(kept);
  kept.dataset.hero = 'true';

  const to = kept.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const scaleX = to.width === 0 ? 1 : from.width / to.width;
  const scaleY = to.height === 0 ? 1 : from.height / to.height;

  const move = kept.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
      { transform: 'none' },
    ],
    { duration: DURATION.normal, easing: 'cubic-bezier(0.2, 0, 0.1, 1)' },
  );
  const done = (): void => {
    kept.style.zIndex = '';
    document.querySelector('#main[inert]')?.removeAttribute('inert');
    if (token !== navigating) return;
    startScreen(page.screen);
    find<HTMLElement>('#page-heading')?.focus();
  };
  move.finished.then(done).catch(done);
}

function sameOrigin(anchor: HTMLAnchorElement): boolean {
  return anchor.origin === window.location.origin;
}

export function startRouter(onScreen: ScreenStart): void {
  startScreen = onScreen;

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (!(anchor instanceof HTMLAnchorElement) || !sameOrigin(anchor)) return;
    if (anchor.hasAttribute('download') || anchor.target === '_blank') return;
    if (anchor.dataset.rail !== undefined) return;
    if (anchor.getAttribute('href')?.startsWith('#')) return;

    const slug = anchor.dataset.caseLink;
    if (slug) {
      const drawing = find<HTMLElement>(`[data-part="case-drawing"][data-case="${slug}"]`, anchor);
      if (drawing) {
        event.preventDefault();
        void navigateCase(anchor.href, slug, drawing);
        return;
      }
    }
    event.preventDefault();
    void navigate(anchor.href);
  });

  window.addEventListener('popstate', () => {
    const token = ++navigating;
    const key = placeKey();
    void loadPage(window.location.href).then((page) => {
      if (!page || token !== navigating) return;
      applyPage(page);
      startScreen(page.screen);
      const place = places.get(key);
      if (place) {
        window.scrollTo(0, place.scroll);
        const back = place.focusCase
          ? find<HTMLElement>(`[data-case-link="${place.focusCase}"]`)
          : null;
        (back ?? find<HTMLElement>('#page-heading'))?.focus();
      } else {
        find<HTMLElement>('#page-heading')?.focus();
      }
    });
  });
}

/** One history entry per committed change of a screen's own parameters. */
export function setQuery(params: Record<string, string | null>, replace = false): string {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(params)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  const next = url.pathname + (url.search === '?' ? '' : url.search);
  if (replace) window.history.replaceState({}, '', next);
  else window.history.pushState({}, '', next);
  return next;
}

/** The header is transparent at the top and solid past 24 px, on arrival too. */
export function watchHeaderScroll(): void {
  const apply = (): void => {
    const header = find<HTMLElement>('#site-header');
    if (!header) return;
    const scrolled = window.scrollY > 24 ? 'true' : 'false';
    if (header.dataset.scrolled !== scrolled) header.dataset.scrolled = scrolled;
  };
  window.addEventListener('scroll', apply, { passive: true });
  apply();
}

export { animate };
