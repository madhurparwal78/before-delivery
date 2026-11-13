// DOM helpers with accessible names the brief publishes.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | null> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (value === true) node.setAttribute(key, '');
    else if (value === false) continue;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') node.append(document.createTextNode(child));
    else node.append(child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function region(label: string, ...children: (Node | string)[]): HTMLElement {
  return el('section', { role: 'region', 'aria-label': label }, ...children);
}

export function statusRegion(label: string, ...children: (Node | string)[]): HTMLElement {
  return el('div', { role: 'status', 'aria-label': label }, ...children);
}

export function group(label: string, ...children: (Node | string)[]): HTMLElement {
  return el('fieldset', { role: 'group', 'aria-label': label }, ...children);
}

export function labelledItem(label: string, value: string): HTMLElement {
  const item = el('div', { class: 'text-item' });
  item.append(el('span', { class: 'text-item-label' }, label));
  item.append(el('span', { class: 'text-item-value num' }, value));
  return item;
}

export function announce(node: HTMLElement, text: string): void {
  clear(node);
  node.append(document.createTextNode(text));
  // A short-lived node forces the region to re-announce.
  node.setAttribute('data-announce-seq', String(Date.now()));
}

export function focusInside(node: HTMLElement): HTMLElement | null {
  const target = node.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
  return target;
}

export function trapFocus(node: HTMLElement, event: KeyboardEvent): void {
  const focusables = Array.from(
    node.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (event.key === 'Tab' && !event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.key === 'Tab' && event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
