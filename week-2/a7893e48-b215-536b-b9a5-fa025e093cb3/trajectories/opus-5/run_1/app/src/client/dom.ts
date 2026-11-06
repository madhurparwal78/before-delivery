type Attributes = Record<string, string | number | boolean | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly (Node | string)[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

function applyAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) continue;
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
}

function append(node: Element, children: readonly (Node | string)[]): void {
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function statusRegion(label: string): HTMLElement {
  return el('p', { role: 'status', 'aria-label': label, 'aria-live': 'polite', class: 'status-line' });
}

export function setStatus(region: HTMLElement, message: string): void {
  region.textContent = message;
}

export function labelled(
  labelText: string,
  control: HTMLElement,
  options: { hint?: string; className?: string } = {},
): HTMLElement {
  const id = control.id === '' ? `field-${Math.random().toString(36).slice(2, 9)}` : control.id;
  control.id = id;
  const children: (Node | string)[] = [
    el('label', { for: id, class: 'field-label' }, [options.hint ?? labelText]),
    control,
  ];
  return el('div', { class: `field ${options.className ?? ''}`.trim() }, children);
}

export function fieldError(): HTMLElement {
  return el('p', { class: 'field-error' });
}
