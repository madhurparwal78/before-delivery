export type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  [key: string]: string | number | boolean | null | undefined | EventListener;
}

/** Build an element. `text` sets textContent and `on*` keys add listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      continue;
    }
    if (key === 'text') {
      el.textContent = String(value);
      continue;
    }
    if (key === 'class') {
      el.className = String(value);
      continue;
    }
    if (value === true) {
      el.setAttribute(key, '');
      continue;
    }
    el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function focus(el: HTMLElement | null): void {
  if (!el) return;
  if (!el.hasAttribute('tabindex') && !FOCUSABLE_TAGS.has(el.tagName)) {
    el.setAttribute('tabindex', '-1');
  }
  el.focus();
}

const FOCUSABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}
