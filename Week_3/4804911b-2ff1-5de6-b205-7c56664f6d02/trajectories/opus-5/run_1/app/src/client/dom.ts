type Attributes = Record<string, string | number | boolean | null>;

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  for (const child of children) node.append(child);
  return node;
}

export function applyAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (name === 'class') node.setAttribute('class', String(value));
    else node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function svgElement(tag: string, attributes: Attributes = {}): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyAttributes(node, attributes);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

/** Replaces a region's children, keeping the element itself so focus and roles survive. */
export function fill(node: Element, children: (Node | string)[]): void {
  clear(node);
  for (const child of children) node.append(child);
}

export function text(value: string): Text {
  return document.createTextNode(value);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function onReducedMotionChange(listener: () => void): void {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', listener);
}

export function viewportWidth(): number {
  return window.innerWidth;
}

/** Announces once in a named live region without disturbing anything else. */
export function announce(region: Element | null, message: string): void {
  if (region === null) return;
  if (region.textContent === message) {
    region.textContent = '';
    window.setTimeout(() => {
      region.textContent = message;
    }, 20);
    return;
  }
  region.textContent = message;
}

export function focusWithoutScroll(node: HTMLElement | null): void {
  if (node === null) return;
  node.focus({ preventScroll: true });
}

export function monotonic(): number {
  return performance.now();
}

const FIXED_LAYERS = '.marquee-wrap, nav.reels, .reels-toggle, .day-slip, .day-status, .desk-bar, .modal';
/** Controls inside the pinned view ride with the stage, so scrolling never clears them. */
const PINNED_LAYERS = '.pinned';

function coveredOrOffScreen(node: HTMLElement): number {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return 0;
  if (rect.bottom > window.innerHeight) return rect.bottom - window.innerHeight + 8;
  if (rect.top < 0) return rect.top - 8;
  const centre = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const topmost = document.elementFromPoint(centre.x, centre.y);
  if (topmost === null || node.contains(topmost) || node === topmost) return 0;
  const covering = topmost.closest(FIXED_LAYERS) as HTMLElement | null;
  if (covering === null) return 0;
  const coveringRect = covering.getBoundingClientRect();
  if (coveringRect.top > rect.top) return rect.bottom - coveringRect.top + 8;
  return rect.top - coveringRect.bottom - 8;
}

/**
 * A control that takes focus is brought wholly on screen, clear of the fixed
 * layers, without moving anything that was already in the clear.
 */
export function keepFocusClearOfFixedLayers(): void {
  document.addEventListener('focusin', (event) => {
    const node = event.target as HTMLElement | null;
    if (node === null || node.closest(FIXED_LAYERS) !== null) return;
    if (node.closest(PINNED_LAYERS) !== null) return;
    window.requestAnimationFrame(() => {
      const delta = coveredOrOffScreen(node);
      if (delta !== 0) window.scrollBy({ top: delta });
    });
  });
}
