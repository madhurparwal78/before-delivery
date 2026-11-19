import { query } from './dom.js';
import { reduced } from './motion.js';

export const MIN_TOP = 72;
export const JUMP_TOP = 88;

let exempt: Element | null = null;

const isExempt = (element: Element): boolean =>
  element.closest('.header') !== null ||
  element.closest('.skip-link') !== null ||
  element.closest('dialog[open]') !== null;

/** Two pixels of slack keep fractional scroll positions above the published 72 px. */
const SAFE_TOP = MIN_TOP + 2;

export function keepClear(element: Element): void {
  if (element === exempt || isExempt(element)) return;
  const box = element.getBoundingClientRect();
  const height = window.innerHeight;
  let delta = 0;
  if (box.top < SAFE_TOP) {
    delta = Math.floor(box.top - SAFE_TOP);
  } else if (box.bottom > height - 1 && box.height <= height - SAFE_TOP) {
    delta = Math.min(Math.ceil(box.bottom - height) + 2, Math.floor(box.top - SAFE_TOP));
  }
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' });
}

export function scrollTop(target: number, instant = false): void {
  window.scrollTo({
    top: Math.max(0, target),
    behavior: instant || reduced() ? 'instant' : 'smooth',
  });
}

export function focusWithout(element: HTMLElement): void {
  exempt = element;
  element.focus({ preventScroll: true });
}

export function jumpToHeading(heading: HTMLElement, instant = false): void {
  const target = window.scrollY + heading.getBoundingClientRect().top - JUMP_TOP;
  focusWithout(heading);
  scrollTop(target, instant);
}

export function jumpToSection(id: string, instant = false): void {
  const heading = query<HTMLElement>(`#${id}-heading`);
  if (heading) jumpToHeading(heading, instant);
}

export function jumpToSectionControl(id: string, control: HTMLElement): void {
  const heading = query<HTMLElement>(`#${id}-heading`);
  if (!heading) return;
  const headingTarget = window.scrollY + heading.getBoundingClientRect().top - JUMP_TOP;
  const box = control.getBoundingClientRect();
  const controlTop = box.top + window.scrollY - headingTarget;
  const target =
    controlTop + box.height > window.innerHeight
      ? window.scrollY + box.top - MIN_TOP - 16
      : headingTarget;
  focusWithout(control);
  scrollTop(target);
}

/** Runs after the browser's own fragment scroll, which resets focus to the body. */
export function afterLoad(run: () => void): void {
  if (document.readyState === 'complete') {
    requestAnimationFrame(run);
    return;
  }
  window.addEventListener('load', () => requestAnimationFrame(run), { once: true });
}

export function initFocusGuard(): void {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target !== exempt) exempt = null;
    keepClear(target);
    requestAnimationFrame(() => keepClear(target));
  });
}
