type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | Child[];

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child = null,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  setAttrs(node, attrs);
  append(node, children);
  return node;
}

export function setAttrs(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(key);
      continue;
    }
    if (key === 'class') node.setAttribute('class', String(value));
    else node.setAttribute(key, value === true ? '' : String(value));
  }
}

export function append(node: Element, children: Child): void {
  if (children === null || children === undefined) return;
  if (Array.isArray(children)) {
    for (const child of children) append(node, child);
    return;
  }
  node.appendChild(typeof children === 'string' ? document.createTextNode(children) : children);
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

/** Keeps Tab inside an open dialog, sheet or popover and returns focus on close. */
export function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable(container);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}

export function on<K extends keyof HTMLElementEventMap>(
  node: HTMLElement,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
): void {
  node.addEventListener(type, handler as EventListener);
}
