type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: (Node | string)[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

function apply(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.setAttribute('class', String(value));
    else if (key === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
}

function append(node: Element, children: (Node | string)[]): void {
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function need<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element ${id}`);
  return node as unknown as T;
}

export function fromHtml(markup: string): Element {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = markup;
  const first = wrapper.firstElementChild;
  if (first === null) throw new Error('empty markup');
  return first;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keeps Tab and Shift+Tab inside a dialog, wrapping from the last control to the first. */
export function trapFocus(container: HTMLElement): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = [...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])',
    )].filter((node) => node.offsetParent !== null || node === document.activeElement);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', handler);
  return handler;
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function elapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function oneDecimal(value: number): string {
  return value.toFixed(1);
}
