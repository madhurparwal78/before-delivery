export type Attrs = Record<string, unknown> & { style?: Partial<CSSStyleDeclaration> | string };

/** Builds an element with children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (key === "class") node.className = String(value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key === "dataset") Object.assign(node.dataset, value as Record<string, string>);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (key === "text") node.textContent = String(value);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false) node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  const selector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((n) => n.offsetParent !== null || n === document.activeElement);
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function watchReducedMotion(cb: () => void): void {
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", cb);
}

export function isWide(): boolean {
  return window.innerWidth >= 768;
}

export function viewportShort(): boolean {
  return window.innerHeight < 500;
}

export type Unsubscribe = () => void;

export function onEvent(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): Unsubscribe {
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}
