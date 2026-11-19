type Attributes = Record<string, string | number | boolean | null | undefined>;

export type Child = Node | string | null | undefined | Child[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child = null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function svg(tag: string, attributes: Attributes = {}, children: Child = null): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

function append(node: Node, children: Child): void {
  if (children === null || children === undefined) return;
  if (Array.isArray(children)) {
    for (const child of children) append(node, child);
    return;
  }
  node.appendChild(typeof children === 'string' ? document.createTextNode(children) : children);
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Each announcement enters its region exactly once per change. */
export function announce(region: HTMLElement, message: string): void {
  if (region.textContent === message) return;
  region.textContent = message;
}

export function on<K extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  node.addEventListener(type, handler as EventListener, options);
}

/**
 * Puts `nodes` in order inside `parent`, moving only the ones out of place. Re-appending a
 * node that already sits in the right place would blur whatever has focus inside it.
 */
export function ensureOrder(parent: Element, nodes: Element[]): void {
  let reference: Element | null = parent.firstElementChild;
  for (const node of nodes) {
    if (reference === node) {
      reference = node.nextElementSibling;
      continue;
    }
    parent.insertBefore(node, reference);
  }
}
