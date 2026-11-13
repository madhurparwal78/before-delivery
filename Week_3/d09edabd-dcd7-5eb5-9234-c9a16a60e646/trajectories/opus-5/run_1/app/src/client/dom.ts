export type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attributes);
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function apply(node: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove();
}

export function button(
  label: string,
  attributes: Attributes = {},
  children: (Node | string | null)[] | null = null,
): HTMLButtonElement {
  const node = el('button', { type: 'button', 'aria-label': label, ...attributes });
  if (children === null) node.textContent = label;
  else for (const child of children) if (child !== null) node.append(child);
  return node;
}

export function iconButton(label: string, svg: string, attributes: Attributes = {}): HTMLButtonElement {
  const node = button(label, attributes, []);
  const holder = el('span', { class: 'icon', 'aria-hidden': 'true' });
  holder.innerHTML = svg;
  node.append(holder);
  return node;
}

export function field(
  label: string,
  input: HTMLElement,
  error?: HTMLElement | null,
): HTMLLabelElement {
  const wrap = el('label', { class: 'field' }, [el('span', { text: label }), input]);
  if (error) wrap.append(error);
  return wrap;
}

export function textbox(label: string, attributes: Attributes = {}): HTMLInputElement {
  return el('input', { type: 'text', 'aria-label': label, ...attributes });
}

export function focusables(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
    ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/** Tab wraps inside a dialog, and focus never reaches the page behind. */
export function trapTab(root: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = focusables(root);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function isTextField(node: Element | null): boolean {
  if (!node) return false;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (node as HTMLInputElement).type;
  return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'file';
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhone(): boolean {
  return window.innerWidth < 768;
}
