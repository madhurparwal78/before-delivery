export type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | number | boolean | null | undefined | Child[];

function append(parent: Element, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item);
    return;
  }
  parent.appendChild(
    child instanceof Node ? child : document.createTextNode(String(child)),
  );
}

function applyAttrs(node: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      node.setAttribute(name, '');
      continue;
    }
    node.setAttribute(name, String(value));
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** Replaces a node's children, skipping the null and false branches of conditionals. */
export function setChildren(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
