type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  apply(element, attributes);
  for (const child of children) {
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function apply(element: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      element.removeAttribute(name);
      continue;
    }
    if (name === 'class') element.className = String(value);
    else if (value === true) element.setAttribute(name, '');
    else element.setAttribute(name, String(value));
  }
}

export function text(tag: keyof HTMLElementTagNameMap, content: string, attributes: Attributes = {}): HTMLElement {
  return el(tag, attributes, [content]);
}

export function clear(element: HTMLElement): void {
  element.replaceChildren();
}

export function button(label: string, attributes: Attributes = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attributes }, [label]);
}

export function focusable(root: HTMLElement): HTMLElement[] {
  const found = root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  return [...found].filter((element) => element.offsetParent !== null || element === document.activeElement);
}
