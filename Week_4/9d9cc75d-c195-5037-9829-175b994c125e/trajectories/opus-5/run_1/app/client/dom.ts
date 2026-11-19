export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null)[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

function apply(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(node: Element, children: (Node | string | null)[]): void {
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function on<K extends keyof HTMLElementEventMap>(
  node: Element,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): void {
  node.addEventListener(type, handler as EventListener);
}

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => node.offsetParent !== null || node.getAttribute('tabindex') === '0');
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhone(): boolean {
  return window.innerWidth < 768;
}
