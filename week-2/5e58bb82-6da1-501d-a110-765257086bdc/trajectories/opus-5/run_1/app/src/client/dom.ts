type Attributes = Record<string, string | number | boolean | null | undefined>;

/** Creates an element with attributes and children, applying ARIA names verbatim. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function applyAttributes(node: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'value' && node instanceof HTMLInputElement) node.value = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
}

/** Writes text only when it differs, so repaints never disturb focus or selection. */
export function setText(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(label: string, attributes: Attributes = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attributes }, [label]);
}

/**
 * Updates a keyed list in place: existing rows keep their element and position,
 * so a changed row stays the same element and never replays its entrance.
 */
export function reconcile<T>(
  container: Element,
  items: T[],
  keyOf: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (node: HTMLElement, item: T) => void,
): HTMLElement[] {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const key = (child as HTMLElement).dataset.key;
    if (key !== undefined) existing.set(key, child as HTMLElement);
  }
  const ordered: HTMLElement[] = [];
  for (const item of items) {
    const key = keyOf(item);
    let node = existing.get(key);
    if (node) {
      existing.delete(key);
      update(node, item);
    } else {
      node = create(item);
      node.dataset.key = key;
      update(node, item);
    }
    ordered.push(node);
  }
  for (const stale of existing.values()) stale.remove();
  ordered.forEach((node, index) => {
    const current = container.children[index];
    if (current !== node) container.insertBefore(node, current ?? null);
  });
  return ordered;
}

/** Keeps Tab and Shift+Tab inside an open modal dialog. */
export function trapFocus(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
