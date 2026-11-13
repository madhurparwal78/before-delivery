export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attrs);
  for (const child of children) node.append(child);
  return node;
}

export function apply(node: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
    } else if (value === true) {
      node.setAttribute(name, '');
    } else if (name === 'class') {
      node.setAttribute('class', String(value));
    } else {
      node.setAttribute(name, String(value));
    }
  }
}

export function svg(tag: string, attrs: Attrs = {}, children: (Node | string)[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(node, attrs);
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function find<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function all<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export function on<K extends keyof HTMLElementEventMap>(
  node: EventTarget,
  type: K | string,
  handler: (event: HTMLElementEventMap[K] & { target: HTMLElement }) => void,
  options?: AddEventListenerOptions,
): () => void {
  const listener = handler as EventListener;
  node.addEventListener(type, listener, options);
  return () => node.removeEventListener(type, listener, options);
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function narrow(): boolean {
  return window.innerWidth < 1024;
}

/** A severity or state icon, always beside its word, never colour alone. */
export function icon(kind: 'blocking' | 'advisory' | 'pass' | 'alert', hollow = false): SVGElement {
  const paths: Record<string, string> = {
    blocking: 'M8 1 L15 14 L1 14 Z',
    advisory: 'M8 1 L15 14 L1 14 Z',
    pass: 'M2 9 L6 13 L14 3',
    alert: 'M8 1 L15 14 L1 14 Z',
  };
  const node = svg(
    'svg',
    {
      viewBox: '0 0 16 16',
      class: `severity-icon severity-icon-${kind}${hollow ? ' severity-icon-hollow' : ''}`,
      'aria-hidden': 'true',
      focusable: 'false',
    },
    [
      svg('path', {
        d: paths[kind],
        fill: kind === 'pass' ? 'none' : hollow ? 'none' : 'currentColor',
        stroke: 'currentColor',
        'stroke-width': kind === 'pass' ? 2 : 1.5,
      }),
    ],
  );
  return node;
}

export function announce(region: HTMLElement | null, message: string): void {
  if (!region) return;
  region.textContent = message;
}
