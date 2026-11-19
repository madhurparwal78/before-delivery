export type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Builds an element. Styles are set through the CSSOM, never as an attribute. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function on<K extends keyof HTMLElementEventMap>(
  node: EventTarget,
  type: K | string,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  node.addEventListener(type, handler as EventListener, options);
}

export function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** Runs one of the published animations, unless reduced motion is asked for. */
export function animate(
  node: Element,
  id: string,
  keyframes: Keyframe[],
  duration: number,
  delay = 0,
): Animation | null {
  if (reducedMotion()) return null;
  const animation = node.animate(keyframes, {
    duration,
    delay,
    easing: EASING,
    fill: 'none',
    timeline: document.timeline,
  });
  animation.id = id;
  return animation;
}
