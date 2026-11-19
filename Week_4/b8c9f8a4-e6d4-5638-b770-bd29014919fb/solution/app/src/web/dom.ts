// Small helpers for building and patching the page. Updates are targeted: a poll must never
// clear a typed value, move focus or move the scroll position.

type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function setAttrs(node: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (name === 'class') node.className = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function svg(markup: string): SVGElement {
  const holder = document.createElement('div');
  holder.innerHTML = markup.trim();
  return holder.firstElementChild as SVGElement;
}

/** Sets text only when it differs, so a poll leaves the DOM alone when nothing changed. */
export function setText(node: Element | null, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

export function setAttr(node: Element | null, name: string, value: string): void {
  if (node && node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

export function all<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export function on<K extends keyof HTMLElementEventMap>(
  node: Element | Document | Window,
  type: K | string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions,
): void {
  node.addEventListener(type, handler as EventListener, options);
}

/**
 * Keeps a keyed list in step with the data: rows that stay keep their nodes, and with them any
 * typed value, pending state and focus.
 */
export function keyedList<T>(
  parent: Element,
  items: T[],
  keyOf: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (node: HTMLElement, item: T) => void,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of [...parent.children]) {
    const key = child.getAttribute('data-key');
    if (key !== null) existing.set(key, child as HTMLElement);
  }
  let previous: HTMLElement | null = null;
  for (const item of items) {
    const key = keyOf(item);
    let node = existing.get(key);
    if (node) {
      existing.delete(key);
      update(node, item);
    } else {
      node = create(item);
      node.setAttribute('data-key', key);
      update(node, item);
    }
    const next: Element | null = previous ? previous.nextElementSibling : parent.firstElementChild;
    if (next !== node) parent.insertBefore(node, next);
    previous = node;
  }
  for (const node of existing.values()) node.remove();
}

/** Makes a parent hold exactly these children, leaving any that stay untouched so they keep focus. */
export function syncChildren(parent: Element, wanted: Element[]): void {
  for (const child of [...parent.children]) {
    if (!wanted.includes(child)) child.remove();
  }
  wanted.forEach((node, index) => {
    const at = parent.children[index] ?? null;
    if (at !== node) parent.insertBefore(node, at);
  });
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhone(): boolean {
  return window.matchMedia('(max-width: 767px)').matches;
}
