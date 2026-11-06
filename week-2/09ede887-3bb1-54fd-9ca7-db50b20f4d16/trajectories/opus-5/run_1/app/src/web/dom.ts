export type Child = Node | string | null | undefined;
export type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function markup(tag: 'span' | 'p' | 'div', className: string, html: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  // Server-rendered bio markup, limited to the published CommonMark subset.
  node.innerHTML = html;
  return node;
}

export function liveRegion(name: string, className = 'live'): HTMLParagraphElement {
  return el('p', { class: className, role: 'status', 'aria-live': 'polite', 'aria-label': name });
}

export function say(region: HTMLElement, message: string | null, extra: readonly Child[] = []): void {
  region.replaceChildren();
  if (message === null) return;
  region.appendChild(document.createTextNode(message));
  append(region, extra);
}

export function groupNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
