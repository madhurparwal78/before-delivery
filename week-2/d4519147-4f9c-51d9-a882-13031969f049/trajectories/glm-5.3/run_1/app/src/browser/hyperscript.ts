// A tiny hyperscript helper: no framework, just elements.

export type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs?: Record<string, string | number | boolean | ((e: Event) => void)> | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs !== undefined && attrs !== null) {
    for (const [name, value] of Object.entries(attrs)) {
      if (typeof value === 'function') {
        el.addEventListener(name.startsWith('on') ? name.slice(2).toLowerCase() : name, value as EventListener);
      } else if (value === true) {
        el.setAttribute(name, '');
      } else if (value !== false && value !== null && value !== undefined) {
        el.setAttribute(name, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function optionEl(value: string, text: string): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  return option;
}

export function svgEl<T extends SVGElement = SVGElement>(tag: string, attrs?: Record<string, string | number | boolean>): T {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag) as T;
  if (attrs !== undefined) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === true) el.setAttribute(name, '');
      else if (value !== false) el.setAttribute(name, String(value));
    }
  }
  return el;
}

export function append(parent: HTMLElement | SVGElement | DocumentFragment, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string') {
      parent.appendChild(document.createTextNode(child));
    } else {
      parent.appendChild(child);
    }
  }
}

export function clear(el: HTMLElement | SVGElement): void {
  while (el.firstChild !== null) {
    el.removeChild(el.firstChild);
  }
}

// Focus the first focusable control inside a container.
export function focusFirst(container: HTMLElement): void {
  const focusable = container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  for (const el of focusable) {
    if (el.getAttribute('tabindex') !== '-1' && !el.hasAttribute('disabled')) {
      el.focus();
      return;
    }
  }
}

export function focusFirstIn(container: HTMLElement, selector: string): void {
  const el = container.querySelector<HTMLElement>(selector);
  if (el !== null) el.focus();
}

