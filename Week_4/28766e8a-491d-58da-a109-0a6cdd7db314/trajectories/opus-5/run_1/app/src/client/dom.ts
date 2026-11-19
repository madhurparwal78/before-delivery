export type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
export type Child = Node | string | number | null | undefined | false;

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyAttrs(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (typeof value === 'function') continue;
    if (key === 'class') {
      node.setAttribute('class', String(value));
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
}

function appendChildren(node: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

export function s(tag: string, attrs: Attrs = {}, ...children: Child[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node: Element, ...children: Child[]): void {
  clear(node);
  appendChildren(node, children);
}

export function query<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function queryAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/** Elements that can hold focus, in document order, inside a dialog, sheet or menu. */
export function focusables(root: ParentNode): HTMLElement[] {
  return queryAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
      ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    root,
  ).filter((node) => node.offsetParent !== null || node.getClientRects().length > 0);
}

/**
 * Tab and Shift+Tab wrap inside a dialog, sheet or menu, Escape closes it and focus
 * returns to the control that opened it.
 */
export function trapFocus(root: HTMLElement, close: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  root.addEventListener('keydown', onKeyDown);
  return () => root.removeEventListener('keydown', onKeyDown);
}

export function focusFirst(root: HTMLElement): void {
  const items = focusables(root);
  (items[0] ?? root).focus();
}

export function setPressed(button: HTMLElement, pressed: boolean): void {
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

export function setExpanded(button: HTMLElement, expanded: boolean): void {
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

/** Initials for a presence avatar. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return `${(parts[0] ?? '')[0] ?? ''}${(parts[parts.length - 1] ?? '')[0] ?? ''}`.toUpperCase();
}
