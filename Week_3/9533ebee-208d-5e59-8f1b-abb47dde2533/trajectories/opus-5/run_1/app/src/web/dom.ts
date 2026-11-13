/** Small helpers for building and updating the ledger sheet in place. */

type Attributes = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: ReadonlyArray<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** A visible label and a separate value element, as every figure is shown. */
export interface LabelledValue {
  readonly row: HTMLElement;
  readonly value: HTMLElement;
}

export function labelled(label: string, options: { figure?: boolean } = {}): LabelledValue {
  const value = el('span', {
    class: options.figure === false ? 'value' : 'value figure',
    id: `v-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${nextId()}`,
  });
  const row = el('div', { class: 'labelled' }, [
    el('span', { class: 'label', text: label, for: value.id }),
    value,
  ]);
  // The accessible name carries the label alone.
  value.setAttribute('aria-label', label);
  return { row, value };
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return String(counter);
}

/** Replaces text only when it changed, so the DOM settles without flicker. */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function setClass(node: Element, name: string, on: boolean): void {
  node.classList.toggle(name, on);
}

/** True when the member asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
