/** DOM helpers for the workspace's focus rules and live regions. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown>, children?: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs !== undefined) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') node.className = String(value);
      else if (name === 'text') node.textContent = String(value);
      else if (name === 'html') node.innerHTML = String(value);
      else if (value === true) node.setAttribute(name, '');
      else node.setAttribute(name, String(value));
    }
  }
  if (children !== undefined) {
    for (const child of children) {
      if (child === null || child === undefined) continue;
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

export function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** A polite live region that keeps its message until the next replaces it. */
export function statusRegion(name: string): HTMLElement {
  const existing = byId(`status-${name}`);
  if (existing !== null) return existing;
  const region = el('div', { id: `status-${name}`, role: 'status', 'aria-live': 'polite', class: 'status' });
  document.body.append(region);
  return region;
}

/** Ensures the app's published live regions exist, empty, from the start. */
export function ensureStatusRegions(names: readonly string[]): void {
  for (const name of names) statusRegion(name);
}

export function announce(name: string, message: string): void {
  statusRegion(name).textContent = message;
}

export function focusElement(target: HTMLElement | null): void {
  if (target !== null) target.focus();
}

export function moveFocus(target: HTMLElement | null): void {
  if (target === null) return;
  target.focus();
}

/** True when the system asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Viewport helpers for the published breakpoints. */
export function viewportIsPhone(): boolean {
  return window.innerWidth < 768;
}

export function viewportIsDesktop(): boolean {
  return window.innerWidth >= 1200;
}
