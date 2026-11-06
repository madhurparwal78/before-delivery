export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    attrs?: Record<string, string>;
    children?: (Node | null)[];
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of options.children ?? []) if (child !== null) node.append(child);
  return node;
}

export function svg(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function focusable(root: ParentNode): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node.getClientRects().length > 0,
  );
}

/** Keep Tab and Shift+Tab inside a dialog, drawer, sheet or the palette. */
export function trapFocus(container: HTMLElement): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusable(container);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && (active === last || !container.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return handler;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (hidden) {
    node.setAttribute('hidden', '');
    node.setAttribute('aria-hidden', 'true');
    node.style.display = 'none';
  } else {
    node.removeAttribute('hidden');
    node.removeAttribute('aria-hidden');
    node.style.removeProperty('display');
  }
}

export function viewportLayout(): 'laptop' | 'tablet' | 'phone' {
  const width = window.innerWidth;
  if (width >= 1200) return 'laptop';
  if (width >= 768) return 'tablet';
  return 'phone';
}

/** While a drawer, sheet or dialog is open, the rest of the page is unavailable. */
export function setOutsideInert(open: boolean, exempt: HTMLElement[]): void {
  const root = document.getElementById('quire-root');
  if (root === null) return;
  const frameNode = root.firstElementChild;
  if (frameNode === null) return;
  for (const child of [...frameNode.children]) {
    if (exempt.includes(child as HTMLElement)) continue;
    if (open) {
      child.setAttribute('inert', '');
      child.setAttribute('aria-hidden', 'true');
    } else {
      child.removeAttribute('inert');
      child.removeAttribute('aria-hidden');
    }
  }
}
