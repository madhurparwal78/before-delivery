export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function append(parent: HTMLElement, children: Array<Node | string | null | undefined>): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    parent.append(child);
  }
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove();
}

export function focus(node: HTMLElement | null): void {
  if (!node) return;
  if (!node.hasAttribute('tabindex') && !isNativelyFocusable(node)) node.setAttribute('tabindex', '-1');
  node.focus();
}

function isNativelyFocusable(node: HTMLElement): boolean {
  return ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName);
}

export function byName<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing element ${selector}`);
  return node;
}

export function setFieldError(root: ParentNode, id: string, copy: string | null): void {
  const error = root.querySelector<HTMLElement>(`#${id}-error`);
  const control = root.querySelector<HTMLElement>(`#${id}`);
  if (!error || !control) return;
  if (copy) {
    clear(error);
    error.append(el('span', { class: 'error-icon', 'aria-hidden': 'true', text: '!' }), `Error: ${copy}`);
    error.hidden = false;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', `${id}-error`);
    return;
  }
  error.hidden = true;
  clear(error);
  control.removeAttribute('aria-invalid');
  control.removeAttribute('aria-describedby');
}
