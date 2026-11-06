/** Small DOM helpers. */
export interface ElementOptions {
  className?: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: (Node | null)[];
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    node.setAttribute(name, value);
  }
  for (const child of options.children ?? []) {
    if (child !== null) node.appendChild(child);
  }
  return node;
}

export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTabletUp(): boolean {
  return window.matchMedia('(min-width: 768px)').matches;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableWithin(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (candidate) =>
      candidate.offsetParent !== null ||
      candidate.getClientRects().length > 0 ||
      candidate === document.activeElement,
  );
}

/** Keeps Tab inside a trace or dialog, wrapping at either end. */
export function containFocus(container: Element, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = focusableWithin(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0] as HTMLElement;
  const last = focusable[focusable.length - 1] as HTMLElement;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
