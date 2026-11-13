import { HELD_MIN_WIDTH } from '../shared/progress';

export function need<E extends Element>(
  selector: string,
  root: ParentNode = document,
): E {
  const found = root.querySelector<E>(selector);
  if (found === null) {
    throw new Error(`Missing element: ${selector}`);
  }
  return found;
}

export function find<E extends Element>(
  selector: string,
  root: ParentNode = document,
): E | null {
  return root.querySelector<E>(selector);
}

export function all<E extends Element>(
  selector: string,
  root: ParentNode = document,
): E[] {
  return [...root.querySelectorAll<E>(selector)];
}

export function fragmentFrom(markup: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}

export function fillWith(host: Element, markup: string): void {
  host.replaceChildren(fragmentFrom(markup));
}

/** The one polite status region. Each announcement replaces its text. */
export function announce(text: string): void {
  need<HTMLElement>('[data-status]').textContent = text;
}

export function showAlert(host: Element, message: string): void {
  clearAlert(host);
  const alert = document.createElement('p');
  alert.className = 'alert';
  alert.setAttribute('role', 'alert');
  alert.textContent = message;
  host.append(alert);
}

export function clearAlert(host: Element): void {
  host.querySelector(':scope > .alert')?.remove();
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function prefersReducedMotion(): boolean {
  return reducedMotion.matches;
}

/** Chapters are held in view at 768 px and wider, unless motion is reduced. */
export function isHeldLayout(): boolean {
  return window.innerWidth >= HELD_MIN_WIDTH && !prefersReducedMotion();
}

export function onLayoutChange(listener: () => void): void {
  window.addEventListener('resize', listener);
  reducedMotion.addEventListener('change', listener);
}

export function scrollPageTo(top: number, smooth: boolean): void {
  window.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
}

export function documentTop(element: Element): number {
  return element.getBoundingClientRect().top + window.scrollY;
}

/** Right to left reports 1, left to right reports -1. */
export function onHorizontalSwipe(
  element: HTMLElement,
  threshold: number,
  handler: (step: 1 | -1) => void,
): void {
  let startX: number | null = null;
  const end = (x: number): void => {
    if (startX === null) {
      return;
    }
    const delta = x - startX;
    startX = null;
    if (Math.abs(delta) >= threshold) {
      handler(delta < 0 ? 1 : -1);
    }
  };
  element.addEventListener(
    'touchstart',
    (event) => {
      startX = event.changedTouches[0]?.clientX ?? null;
    },
    { passive: true },
  );
  element.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    if (touch !== undefined) {
      end(touch.clientX);
    }
  });
  element.addEventListener('mousedown', (event) => {
    startX = event.clientX;
  });
  window.addEventListener('mouseup', (event) => {
    end(event.clientX);
  });
}
