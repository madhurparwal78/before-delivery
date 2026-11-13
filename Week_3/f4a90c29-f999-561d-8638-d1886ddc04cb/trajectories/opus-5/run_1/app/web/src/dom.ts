// Small helpers for building the accessible tree the brief publishes.

type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "class") node.className = String(value);
    else if (name === "text") node.textContent = String(value);
    else if (name === "html") node.innerHTML = String(value);
    else if (name.startsWith("data-") || name.startsWith("aria-") || name === "role") {
      node.setAttribute(name, String(value));
    } else if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function on<T extends Event>(
  node: EventTarget,
  type: string,
  handler: (event: T) => void,
  options?: AddEventListenerOptions,
): void {
  node.addEventListener(type, handler as EventListener, options);
}

export function queryAll<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** reducedMotion reports whether this browser asks for no animation. */
export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** layout reports which published layout this width receives. */
export function layout(): "phone" | "tablet" | "desktop" {
  const width = window.innerWidth;
  if (width < 600) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}
