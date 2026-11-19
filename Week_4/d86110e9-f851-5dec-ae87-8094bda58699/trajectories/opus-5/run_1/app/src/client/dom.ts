export type Child = Node | string | number | null | undefined | false | Child[];

type Props = Record<string, unknown>;

function applyProps(element: Element, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      element.setAttribute('class', String(value));
    } else if (key === 'text') {
      element.textContent = String(value);
    } else if (key === 'tabIndex') {
      (element as HTMLElement).tabIndex = Number(value);
    } else if (key === 'disabled') {
      if (value === true) element.setAttribute('disabled', '');
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) {
      element.setAttribute(key, '');
    } else {
      element.setAttribute(key, String(value));
    }
  }
}

function appendChildren(element: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(element, child);
      continue;
    }
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  applyProps(element, props);
  appendChildren(element, children);
  return element;
}

export function svgEl(tag: string, props: Props = {}, ...children: Child[]): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  applyProps(element, props);
  appendChildren(element, children);
  return element;
}

export function clear(element: Element): void {
  while (element.firstChild !== null) element.firstChild.remove();
}

export function replace(element: Element, ...children: Child[]): void {
  clear(element);
  appendChildren(element, children);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href], [tabindex]')].filter(
    (element) => element.tabIndex !== -1 && !element.hasAttribute('disabled') && element.offsetParent !== null,
  );
}
