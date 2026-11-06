export type Child = Node | string | number | null | undefined | false;

export interface Attributes {
  readonly [key: string]: string | number | boolean | null | undefined | EventListener;
}

const DIRECT_PROPERTIES = new Set(['value', 'checked', 'disabled', 'inert', 'selected', 'open']);

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attributes);
  append(node, children);
  return node;
}

export function svg(tag: string, attributes: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

function apply(node: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2), value as EventListener);
    } else if (DIRECT_PROPERTIES.has(name)) {
      (node as unknown as Record<string, unknown>)[name] = value;
    } else if (value === true) {
      node.setAttribute(name, '');
    } else {
      node.setAttribute(name, String(value));
    }
  }
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

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function fill(node: Node, ...children: Child[]): void {
  clear(node);
  append(node, children);
}

export function focusables(root: HTMLElement): HTMLElement[] {
  const found = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  return [...found].filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0,
  );
}

/** Scrolls a control clear of a sticky bar or bottom sheet edge. */
export function keepClear(control: HTMLElement): void {
  control.scrollIntoView({ block: 'center', inline: 'nearest' });
}
