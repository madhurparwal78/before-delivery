/**
 * Small DOM helpers for building the pages.
 */

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

/** Move focus to an element, tolerating one that is not focusable. */
export function focusOn(target: HTMLElement | null): void {
  target?.focus();
}

/** Set a live region's message politely, replacing whatever it held. */
export function announce(region: HTMLElement | null, message: string): void {
  if (region === null) return;
  region.textContent = message;
}
