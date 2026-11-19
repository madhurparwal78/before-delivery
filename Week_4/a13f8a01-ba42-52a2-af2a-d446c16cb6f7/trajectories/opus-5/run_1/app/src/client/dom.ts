export type Child = Node | string | null | undefined | false;

type Attributes = Record<string, string | number | boolean | EventListener | null | undefined>;

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value);
    } else if (name === 'class') {
      element.className = String(value);
    } else if (name === 'text') {
      element.textContent = String(value);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
  }
  append(element, children);
  return element;
};

export const append = (parent: Node, children: Child[]): void => {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
};

export const clear = (element: Node): void => {
  while (element.firstChild) element.removeChild(element.firstChild);
};

export const replace = (element: Node, children: Child[]): void => {
  clear(element);
  append(element, children);
};

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A polite live region that announces each message it is given. */
export const status = (name: string, extra: Attributes = {}): HTMLElement =>
  h('div', { role: 'status', 'aria-live': 'polite', 'aria-label': name, class: 'status', ...extra });

export const say = (region: HTMLElement | null, message: string): void => {
  if (!region) return;
  region.textContent = message;
};

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusableIn = (element: HTMLElement): HTMLElement[] =>
  Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (candidate) => candidate.offsetParent !== null || candidate === document.activeElement,
  );

/** Keeps Tab and Shift+Tab inside a dialog. */
export const trapFocus = (dialog: HTMLElement) => (event: KeyboardEvent): void => {
  if (event.key !== 'Tab') return;
  const focusable = focusableIn(dialog);
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};
