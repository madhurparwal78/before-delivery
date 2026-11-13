// Tiny DOM helper: create elements with attributes, children and state.
export type Child = Node | string | null | undefined | false;

export function h(
  tag: string,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElement {
  const element = document.createElement(tag);
  applyAttrs(element, attrs);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string') {
      element.appendChild(document.createTextNode(child));
    } else {
      element.appendChild(child);
    }
  }
  return element;
}

export function applyAttrs(element: HTMLElement, attrs: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') {
      element.className = String(value);
    } else if (name === 'dataset') {
      for (const [key, dataValue] of Object.entries(value as Record<string, unknown>)) {
        if (dataValue !== null && dataValue !== undefined) {
          element.dataset[key] = String(dataValue);
        }
      }
    } else if (name === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
    } else if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value as EventListener);
    } else if (name === 'text') {
      element.textContent = String(value);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
  }
}

export function clear(element: HTMLElement): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function el<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector(selector) as T | null;
}

export function focusElement(element: HTMLElement | null | undefined): void {
  if (!element) return;
  element.focus();
}
