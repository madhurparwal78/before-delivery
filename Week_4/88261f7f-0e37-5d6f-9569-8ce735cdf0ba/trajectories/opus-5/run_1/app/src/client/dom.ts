type Attributes = Record<string, string | number | boolean | null | undefined>;

type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') {
      node.className = String(value);
      continue;
    }
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replaceChildren(node: Element, children: Child[]): void {
  clear(node);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function labelled(
  labelText: string,
  control: HTMLElement,
  extra: Child[] = [],
): HTMLElement {
  const id = control.id || `field-${Math.random().toString(36).slice(2)}`;
  control.id = id;
  return el('div', { class: 'field' }, [
    el('label', { for: id, text: labelText }),
    control,
    ...extra,
  ]);
}

export function textbox(name: string, value = '', type = 'text'): HTMLInputElement {
  const input = el('input', { type, value, 'aria-label': name, autocomplete: 'off' });
  return input;
}

export function button(
  name: string,
  onClick: (event: MouseEvent) => void,
  attributes: Attributes = {},
): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attributes }, [name]);
  node.addEventListener('click', onClick);
  return node;
}

export function select(name: string, options: Array<{ value: string; label: string }>, value = ''):
  HTMLSelectElement {
  const node = el('select', { 'aria-label': name });
  for (const option of options) {
    node.append(el('option', { value: option.value, selected: option.value === value }, [option.label]));
  }
  node.value = value;
  return node;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export type Layout = 'phone' | 'tablet' | 'desk';

/** 375 reads as phone, 768 as tablet and 1280 as desk, with nothing between changing that. */
export function currentLayout(): Layout {
  const width = window.innerWidth;
  if (width < 700) return 'phone';
  if (width < 1100) return 'tablet';
  return 'desk';
}

export function focusableWithin(node: HTMLElement): HTMLElement[] {
  return [
    ...node.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((candidate) => candidate.offsetParent !== null || candidate === document.activeElement);
}
