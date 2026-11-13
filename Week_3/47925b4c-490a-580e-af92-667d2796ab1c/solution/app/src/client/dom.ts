type Child = Node | string | null | undefined | false;

interface Attributes {
  readonly [name: string]: string | number | boolean | EventListener | null | undefined;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2), value as EventListener);
      continue;
    }
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function field(
  label: string,
  input: HTMLElement,
  errorId: string,
): HTMLElement {
  input.setAttribute('aria-describedby', errorId);
  return el('label', {}, [label, input, el('span', { class: 'field-error', id: errorId, 'aria-live': 'polite' })]);
}

export function showFieldError(errorId: string, copy: string | null): void {
  const node = document.getElementById(errorId);
  if (node !== null) node.textContent = copy ?? '';
}

export function textbox(name: string, value = '', attributes: Attributes = {}): HTMLInputElement {
  return el('input', { type: 'text', 'aria-label': name, value, ...attributes });
}

export function spinbutton(name: string, value: number, step: number, attributes: Attributes = {}): HTMLInputElement {
  return el('input', {
    type: 'number',
    role: 'spinbutton',
    'aria-label': name,
    step,
    value: String(value),
    ...attributes,
  });
}

export function combobox(name: string, options: readonly { value: string; label: string }[], value?: string): HTMLSelectElement {
  const select = el(
    'select',
    { 'aria-label': name },
    options.map((option) => el('option', { value: option.value, text: option.label })),
  );
  if (value !== undefined) select.value = value;
  return select;
}

export function button(name: string, onClick: () => void, attributes: Attributes = {}): HTMLButtonElement {
  return el('button', { type: 'button', 'aria-label': name, text: name, onclick: onClick, ...attributes });
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** A Lucide glyph from the bundled sprite, decorative beside the words that name the control. */
export function icon(name: 'scan-line' | 'package' | 'handshake' | 'triangle-alert'): SVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NAMESPACE, 'use');
  use.setAttribute('href', `/icons.svg#icon-${name}`);
  svg.appendChild(use);
  return svg;
}
