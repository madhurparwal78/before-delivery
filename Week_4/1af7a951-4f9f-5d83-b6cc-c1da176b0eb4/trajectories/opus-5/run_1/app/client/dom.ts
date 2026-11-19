type Attrs = Record<string, string | number | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
