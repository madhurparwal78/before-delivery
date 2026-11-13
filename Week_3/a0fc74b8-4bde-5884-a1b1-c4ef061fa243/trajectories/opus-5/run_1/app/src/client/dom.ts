export type Attrs = Record<string, string | number | boolean | null>;

export type Child = Node | string | null | undefined | Child[];

const append = (parent: Node, child: Child): void => {
  if (child === null || child === undefined) return;
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item);
    return;
  }
  parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
};

export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  for (const child of children) append(node, child);
  return node;
};

export const setAttrs = (node: Element, attrs: Attrs): void => {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (value === true) {
      node.setAttribute(name, '');
      continue;
    }
    node.setAttribute(name, String(value));
  }
};

export const clear = (node: Node): void => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

export const replace = (node: Node, ...children: Child[]): void => {
  clear(node);
  for (const child of children) append(node, child);
};

export const on = <K extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void => {
  node.addEventListener(type, handler, options);
};

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isNarrow = (): boolean => window.matchMedia('(max-width: 480px)').matches;

/** Announces text in a status region, repeating it when the text is unchanged. */
export const announce = (region: HTMLElement, message: string): void => {
  if (region.textContent === message) {
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 30);
    return;
  }
  region.textContent = message;
};

export const statusRegion = (label: string, className = 'sr-status'): HTMLElement =>
  h('div', { role: 'status', 'aria-label': label, 'aria-live': 'polite', class: className });

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const focusableIn = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
