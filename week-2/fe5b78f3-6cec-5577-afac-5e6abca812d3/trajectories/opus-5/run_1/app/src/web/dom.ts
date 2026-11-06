export type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: Child[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function applyAttrs(node: HTMLElement, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
}

export function append(node: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhoneWidth(): boolean {
  return window.matchMedia('(max-width: 767.98px)').matches;
}

export function isDesktopWidth(): boolean {
  return window.matchMedia('(min-width: 1200px)').matches;
}

/** Keeps Tab inside a dialog and returns focus to the control that opened it. */
export function trapFocus(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])',
  )].filter((node) => node.offsetParent !== null || node === document.activeElement);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}
