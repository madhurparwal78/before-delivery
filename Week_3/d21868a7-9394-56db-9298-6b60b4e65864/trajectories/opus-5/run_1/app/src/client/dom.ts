/** Small DOM helpers. Every screen builds its elements through these. */

export type Child = Node | string | null | undefined;

export interface Options {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Record<string, (event: Event) => void>;
  children?: readonly Child[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: Options = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class !== undefined) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, listener] of Object.entries(options.on ?? {})) {
    node.addEventListener(name, listener);
  }
  append(node, options.children ?? []);
  return node;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * Repaints a block only when its figures changed, so a live refresh never
 * destroys the control the person is using.
 */
export function renderWhenChanged(node: HTMLElement, signature: string, render: () => void): void {
  if (node.dataset.signature === signature) return;
  node.dataset.signature = signature;
  clear(node);
  render();
}

export function svg(markup: string, className: string): SVGSVGElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}" aria-hidden="true">${markup}</svg>`;
  return wrapper.firstElementChild as SVGSVGElement;
}

/** Keeps Tab, Shift+Tab and Escape inside an open dialog, sheet or drawer. */
export function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableIn(container);
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = document.activeElement;
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
  container.addEventListener('keydown', onKeydown);
  return () => container.removeEventListener('keydown', onKeydown);
}

export function focusableIn(container: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Runs a figure from its old value to a new one over 0.6 seconds. */
export function countTo(node: HTMLElement, from: number, to: number, render: (value: number) => string): void {
  if (from === to) {
    setText(node, render(to));
    return;
  }
  if (prefersReducedMotion()) {
    setText(node, render(to));
    return;
  }
  const duration = 600;
  const started = performance.now();
  const step = (now: number): void => {
    const elapsed = now - started;
    if (elapsed >= duration) {
      setText(node, render(to));
      return;
    }
    const progress = 1 - Math.pow(1 - elapsed / duration, 3);
    setText(node, render(from + (to - from) * progress));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
