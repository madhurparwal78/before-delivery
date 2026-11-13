export type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(child));
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyAttributes(node, attributes);
  for (const child of children) node.append(child instanceof Node ? child : document.createTextNode(child));
  return node;
}

export function applyAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') {
      node.setAttribute('class', String(value));
      continue;
    }
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
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

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function layoutKind(): 'phone' | 'tablet' | 'desk' {
  const width = window.innerWidth;
  if (width < 768) return 'phone';
  if (width < 1280) return 'tablet';
  return 'desk';
}

export function isTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

export function button(label: string, attributes: Attributes = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attributes }, [label]);
}

export function panel(name: string, body: HTMLElement, role: 'region' | 'grid' = 'region'): HTMLElement {
  const header = button(name, { class: 'panel-header', 'aria-expanded': 'true' });
  const wrapper = el('section', { class: 'panel', 'data-panel': name }, [header]);
  const content = el('div', { class: 'panel-body' }, [body]);
  wrapper.append(content);
  body.setAttribute('role', role);
  body.setAttribute('aria-label', name);
  on(header, 'click', () => {
    const open = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', open ? 'false' : 'true');
    content.hidden = open;
  });
  return wrapper;
}
