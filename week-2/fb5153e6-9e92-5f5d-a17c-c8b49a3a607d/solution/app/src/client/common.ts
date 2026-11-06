import { all } from './dom.js';
import { isReceiptPath } from '../shared/locale.js';

/** The attributes that carry published copy or the address's `lang` value. */
const COPIED_ATTRIBUTES = ['aria-label', 'alt', 'placeholder', 'title', 'href', 'action'] as const;

function addressFor(choice: string): string {
  const url = new URL(window.location.href);
  // A receipt always states the choice, because its address without `lang`
  // reads in the order's checkout locale.
  if (choice === 'de' || isReceiptPath(url.pathname)) {
    url.searchParams.set('lang', choice);
  } else {
    url.searchParams.delete('lang');
  }
  return `${url.pathname}${url.search}`;
}

/** Both trees are the same page in two locales, so walking them together keeps
 * every node, and with it the reading position, the focus and every control. */
function mirror(live: Element, fresh: Element): void {
  for (const name of COPIED_ATTRIBUTES) {
    const value = fresh.getAttribute(name);
    if (value !== null && live.getAttribute(name) !== value) live.setAttribute(name, value);
  }
  const liveNodes = [...live.childNodes];
  const freshNodes = [...fresh.childNodes];
  for (let i = 0; i < Math.min(liveNodes.length, freshNodes.length); i += 1) {
    const here = liveNodes[i];
    const there = freshNodes[i];
    if (here === undefined || there === undefined) continue;
    if (here.nodeType === Node.TEXT_NODE && there.nodeType === Node.TEXT_NODE) {
      if (here.nodeValue !== there.nodeValue) here.nodeValue = there.nodeValue;
    } else if (
      here instanceof Element &&
      there instanceof Element &&
      here.tagName === there.tagName
    ) {
      mirror(here, there);
    }
  }
}

/**
 * Choosing a language re-renders every published string in place, rewrites
 * `lang` in the address with a replace, keeps the reading position, and keeps
 * focus on the picker.
 */
async function switchLanguage(choice: string): Promise<void> {
  const address = addressFor(choice);
  const reading = window.scrollY;
  const response = await fetch(address, {
    credentials: 'same-origin',
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) return;
  const fresh = new DOMParser().parseFromString(await response.text(), 'text/html');
  // The swap is painted as one frame: the browser captures the old copy, the
  // new copy replaces it, and the transition has no duration (see app.css), so
  // a half-translated page is never shown.
  const swap = (): void => applyLanguage(fresh, address, choice, reading);
  if (typeof document.startViewTransition === 'function') {
    await document.startViewTransition(swap).updateCallbackDone;
  } else {
    swap();
  }
}

function applyLanguage(fresh: Document, address: string, choice: string, reading: number): void {
  // Longer copy in the other locale rewraps lines above the reading position;
  // the browser's scroll anchoring would then shift scrollY on the next frame.
  // Hold anchoring off until the new copy has been laid out and the position restored.
  const root = document.documentElement;
  const anchoring = root.style.overflowAnchor;
  root.style.overflowAnchor = 'none';
  document.title = fresh.title;
  document.documentElement.lang = fresh.documentElement.lang;
  document.body.dataset.locale = fresh.body.dataset.locale ?? document.body.dataset.locale ?? 'en';
  mirror(document.body, fresh.body);
  window.history.replaceState(window.history.state, '', address);
  const picker = document.querySelector<HTMLSelectElement>('[data-language-picker]');
  if (picker !== null) {
    picker.value = choice;
    picker.focus({ preventScroll: true });
  }
  const restore = (): void => {
    if (window.scrollY !== reading) window.scrollTo({ top: reading, behavior: 'instant' });
  };
  restore();
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(() => {
      restore();
      root.style.overflowAnchor = anchoring;
    });
  });
}

for (const picker of all<HTMLSelectElement>('[data-language-picker]')) {
  picker.addEventListener('change', () => {
    void switchLanguage(picker.value);
  });
}

/**
 * The top bar is sticky, so anything scrolled into view (keyboard focus, a
 * fragment link) must land below it rather than under it.
 */
const topBar = document.querySelector<HTMLElement>('.top-bar');
if (topBar !== null) {
  const pad = (): void => {
    const sticky = getComputedStyle(topBar).position === 'sticky';
    document.documentElement.style.scrollPaddingTop = sticky ? `${topBar.offsetHeight + 8}px` : '';
  };
  pad();
  if (typeof ResizeObserver === 'function') new ResizeObserver(pad).observe(topBar);
}
