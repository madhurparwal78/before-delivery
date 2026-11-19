export function el (tag: string, attrs: Record<string, string | number | boolean | null | undefined | ((event: Event) => void)> = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'click' && typeof value === 'function') node.addEventListener('click', value);
    else if (value === true) node.setAttribute(name, '');
    else if (typeof value !== 'function') node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear (node: HTMLElement): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

let uidCounter = 0;
export const uid = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const REDUCED_MOTION = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;


const announceTimers = new WeakMap<HTMLElement, number>();

export function announce (region: HTMLElement, message: string): void {
  // A later announcement replaces any earlier one still pending.
  const pending = announceTimers.get(region);
  if (pending !== undefined) window.clearTimeout(pending);
  region.textContent = '';
  const timer = window.setTimeout(() => {
    region.textContent = message;
    announceTimers.delete(region);
  }, 30);
  announceTimers.set(region, timer);
}
