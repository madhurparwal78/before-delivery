type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attrs);
  append(node, children);
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: Child[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

function apply(node: HTMLElement, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'value' && node instanceof HTMLInputElement) node.value = String(value);
    else if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
}

export function append(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: Node, children: Child[]): void {
  clear(node);
  append(node, children);
}

/** Resolves once the web fonts the node's text needs have swapped in, so revealing it never shifts. */
export async function fontsSettled(node: HTMLElement): Promise<void> {
  void node.offsetHeight; // lay the text out first, so its font loads are already pending
  await document.fonts.ready.catch(() => undefined);
}

/** A labelled form control, so every field has a real label association. */
export function field(
  label: string,
  input: HTMLElement,
  id: string,
): { wrap: HTMLElement; error: HTMLElement } {
  input.id = id;
  const error = el('p', { class: 'field-error', id: `${id}-error` });
  const wrap = el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: id, text: label }),
    input,
    error,
  ]);
  return { wrap, error };
}

export function setFieldError(input: HTMLElement, error: HTMLElement, message: string): void {
  error.textContent = message;
  if (message === '') {
    input.removeAttribute('aria-describedby');
    input.removeAttribute('aria-invalid');
  } else {
    input.setAttribute('aria-describedby', error.id);
    input.setAttribute('aria-invalid', 'true');
    // The message describes the field only until the field changes.
    const clearOnChange = (): void => {
      if (error.textContent === message) setFieldError(input, error, '');
    };
    input.addEventListener('input', clearOnChange, { once: true });
    input.addEventListener('change', clearOnChange, { once: true });
  }
}

function mono(value: string, extra = ''): HTMLElement {
  return el('span', { class: `mono ${extra}`.trim(), text: value });
}
