type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
      continue;
    }
    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

export function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** A line icon from the shipped set, decorative beside its label. */
export function icon(name: string): HTMLElement {
  return el('img', { class: 'icon', src: `/icons/${name}.svg`, alt: '', 'aria-hidden': 'true' });
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}


/** Keeps Tab and Shift+Tab inside a dialog, sheet or menu. */
export function trapFocus(container: HTMLElement): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusable = [...container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )].filter((node) => !node.hasAttribute('disabled') && node.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === container)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return handler;
}

export function escapeCloses(container: HTMLElement, close: () => void): void {
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
}
