type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(
  label: string,
  attributes: Attributes = {},
  children: (Node | string)[] = []
): HTMLButtonElement {
  return el(
    'button',
    { type: 'button', 'aria-label': label, ...attributes },
    children.length > 0 ? children : [label]
  );
}

export type FieldControl = {
  wrapper: HTMLElement;
  input: HTMLInputElement;
  error: HTMLElement;
};

let fieldSequence = 0;

export function field(
  label: string,
  type: 'text' | 'password' | 'email' | 'number' = 'text',
  attributes: Attributes = {}
): FieldControl {
  fieldSequence += 1;
  const id = `field-${fieldSequence}`;
  const errorId = `${id}-error`;
  const input = el('input', {
    id,
    type,
    'aria-label': label,
    autocomplete: 'off',
    ...attributes
  });
  const error = el('p', { class: 'field-error', id: errorId, role: 'presentation' });
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    input,
    error
  ]);
  return { wrapper, input, error };
}

export function showFieldError(control: FieldControl, message: string | null): void {
  if (message === null) {
    control.error.textContent = '';
    control.input.removeAttribute('aria-invalid');
    control.input.removeAttribute('aria-describedby');
    return;
  }
  control.error.textContent = message;
  control.input.setAttribute('aria-invalid', 'true');
  control.input.setAttribute('aria-describedby', control.error.id);
}

export function setText(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
