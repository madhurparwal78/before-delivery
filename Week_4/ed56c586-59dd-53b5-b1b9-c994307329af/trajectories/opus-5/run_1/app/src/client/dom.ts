/** Shared browser helpers: lookups, focus, announcements and the scroll pulse. */

const HEADER_HEIGHT = 64;
/** A focused element sits at least 8 px below the header's bottom edge. */
const FOCUS_CLEARANCE = HEADER_HEIGHT + 8;
/** A jumped-to heading sits 16 px below the header. */
export const JUMP_OFFSET = HEADER_HEIGHT + 16;

export const query = <T extends Element>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);

export const queryAll = <T extends Element>(
  selector: string,
  root: ParentNode = document,
): T[] => [...root.querySelectorAll<T>(selector)];

export const need = <T extends Element>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Missing element: ${selector}`);
  return element;
};

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isNarrow = (): boolean => window.matchMedia('(max-width: 767px)').matches;

let announcer: HTMLElement | null = null;

export const announce = (text: string): void => {
  announcer ??= need<HTMLElement>('[data-site-updates]');
  announcer.textContent = text;
};

const scrollRules: (() => void)[] = [];

export const onScrollOrResize = (rule: () => void): void => {
  scrollRules.push(rule);
};

export const runScrollRules = (): void => {
  for (const rule of scrollRules) rule();
};

export const watchScroll = (): void => {
  window.addEventListener('scroll', runScrollRules, { passive: true });
  window.addEventListener('resize', runScrollRules);
  runScrollRules();
};

let focusRuleSuspended = false;

/**
 * Keeps a newly focused element clear of the fixed header. Controls in the
 * header and in an open dialog are exempt, since scrolling cannot move them.
 */
const applyFocusRule = (element: HTMLElement): void => {
  const rect = element.getBoundingClientRect();
  let delta = 0;
  if (rect.top < FOCUS_CLEARANCE) {
    delta = rect.top - FOCUS_CLEARANCE;
  } else if (rect.bottom > window.innerHeight && rect.height <= window.innerHeight - FOCUS_CLEARANCE) {
    delta = Math.min(rect.bottom - window.innerHeight, rect.top - FOCUS_CLEARANCE);
  }
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' });
};

const exemptFromFocusRule = (element: Element): boolean =>
  element.closest('.site-header, .dialog-layer, .skip-link') !== null;

export const watchFocus = (): void => {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (focusRuleSuspended || !(target instanceof HTMLElement)) return;
    if (exemptFromFocusRule(target)) return;
    applyFocusRule(target);
  });
};

/** Focus without the clearance rule, for moves that place the element themselves. */
export const focusPlaced = (element: HTMLElement): void => {
  focusRuleSuspended = true;
  element.focus({ preventScroll: true });
  focusRuleSuspended = false;
};

export const focusWithRule = (element: HTMLElement): void => {
  element.focus({ preventScroll: true });
  if (!exemptFromFocusRule(element)) applyFocusRule(element);
};

/** The heading that names a section, which is where a section jump lands. */
export const headingOf = (section: Element): HTMLElement => {
  const heading = section.matches('h1, h2')
    ? (section as HTMLElement)
    : section.querySelector<HTMLElement>('h1, h2');
  if (heading === null) throw new Error('Section without a heading');
  return heading;
};

export const setHidden = (element: HTMLElement, hidden: boolean): void => {
  element.hidden = hidden;
  if (hidden) element.setAttribute('inert', '');
  else element.removeAttribute('inert');
};
