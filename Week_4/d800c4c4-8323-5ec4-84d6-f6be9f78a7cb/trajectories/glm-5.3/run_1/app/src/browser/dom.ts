// DOM helpers: building elements with roles and names the tests find.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | number | boolean | null | undefined> = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function focusSafe(target: HTMLElement | null): void {
  if (target !== null) {
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: false });
  }
}

/** Announce by replacing a live region's whole text. */
export function announce(region: HTMLElement, text: string): void {
  region.textContent = text;
}

export function money(cents: number): string {
  const dollars = Math.floor(Math.abs(cents) / 100);
  const rem = Math.abs(cents) % 100;
  return `${cents < 0 ? '-' : ''}$${dollars.toLocaleString('en-US')}.${String(rem).padStart(2, '0')}`;
}
