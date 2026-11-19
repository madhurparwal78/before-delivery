/** Small DOM helpers, the dialog stack with its focus trap, and the Notices region. */

type Attributes = Record<string, string | number | boolean | null | undefined | EventListener>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttributes(node, attributes);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function setAttributes(node: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (typeof value === 'function') {
      node.addEventListener(name.replace(/^on/, ''), value as EventListener);
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

export function icon(name: string, extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `/icons.svg#i-${name}`);
  svg.append(use);
  return svg;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusableInside(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export interface OpenLayer {
  node: HTMLElement;
  onEscape?: () => void;
  returnFocus?: HTMLElement | null;
  initialFocus?: () => HTMLElement | null;
  /**
   * Dialogs also hide what is behind them from assistive technology. The
   * Filters sheet does not, because its chips update the results behind it.
   */
  keepBackgroundReadable?: boolean;
}

const layers: OpenLayer[] = [];

/** Everything behind the topmost layer cannot be focused, clicked or read. */
function applyInertness(): void {
  const root = document.getElementById('app');
  if (!root) return;
  const top = layers[layers.length - 1];
  for (const child of [...root.children] as HTMLElement[]) {
    const holdsTop = top ? child.contains(top.node) : false;
    const inert = Boolean(top) && !holdsTop;
    child.toggleAttribute('inert', inert);
    if (inert && !top?.keepBackgroundReadable) child.setAttribute('aria-hidden', 'true');
    else child.removeAttribute('aria-hidden');
  }
  if (top) {
    for (const sibling of [...(top.node.parentElement?.children ?? [])] as HTMLElement[]) {
      if (sibling === top.node) continue;
      sibling.toggleAttribute('inert', true);
      if (!top.keepBackgroundReadable) sibling.setAttribute('aria-hidden', 'true');
    }
  }
}

export function openLayer(layer: OpenLayer): void {
  layers.push(layer);
  applyInertness();
  const target = layer.initialFocus?.() ?? focusableInside(layer.node)[0] ?? layer.node;
  target.focus();
}

export function closeLayer(node: HTMLElement, moveFocus = true): void {
  const index = layers.findIndex((layer) => layer.node === node);
  if (index < 0) return;
  const [layer] = layers.splice(index, 1);
  layer.node.remove();
  for (const element of document.querySelectorAll('[inert]')) {
    element.removeAttribute('inert');
    element.removeAttribute('aria-hidden');
  }
  applyInertness();
  if (moveFocus && layer.returnFocus && layer.returnFocus.isConnected) layer.returnFocus.focus();
}

/** Leaving a page closes everything that was open over it. */
export function closeAllLayers(): void {
  for (const layer of layers.splice(0)) layer.node.remove();
  for (const element of document.querySelectorAll('[inert]')) {
    element.removeAttribute('inert');
    element.removeAttribute('aria-hidden');
  }
}

document.addEventListener('keydown', (event) => {
  const layer = layers[layers.length - 1];
  if (!layer) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    if (layer.onEscape) layer.onEscape();
    else closeLayer(layer.node);
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = focusableInside(layer.node);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (!event.shiftKey && (active === last || !layer.node.contains(active))) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && (active === first || !layer.node.contains(active))) {
    event.preventDefault();
    last.focus();
  }
});

let noticesRegion: HTMLElement | null = null;

export function noticesNode(): HTMLElement {
  if (!noticesRegion) {
    noticesRegion = el('div', { class: 'notices', role: 'status', 'aria-live': 'polite', 'aria-label': 'Notices' });
  }
  return noticesRegion;
}

export function announce(message: string): void {
  const node = noticesNode();
  node.textContent = '';
  window.setTimeout(() => {
    node.textContent = message;
  }, 30);
}
