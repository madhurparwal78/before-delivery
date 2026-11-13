type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttributes(node, attributes);
  append(node, children);
  return node;
}

function applyAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.setAttribute('class', String(value));
    else node.setAttribute(name, String(value));
  }
}

function append(node: Element, children: (Node | string)[]): void {
  for (const child of children) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fieldRow(
  label: string,
  input: HTMLElement,
  error: string | undefined,
  id: string,
): HTMLElement {
  input.id = id;
  const children: (Node | string)[] = [el('label', { for: id }, [label]), input];
  if (error !== undefined) {
    const errorId = `${id}-error`;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', errorId);
    children.push(el('p', { class: 'field-error', id: errorId }, [error]));
  }
  return el('div', { class: 'field' }, children);
}

export function textField(
  label: string,
  id: string,
  value: string,
  error?: string,
  type = 'text',
): HTMLElement {
  const input = el('input', { type, value, autocomplete: 'off', 'data-focus-key': id });
  return fieldRow(label, input, error, id);
}

/** Remembers which control has focus so a re-render can hand it back. */
export function captureFocus(): { key: string; start: number | null } | null {
  const active = document.activeElement as HTMLElement | null;
  const key = active?.dataset?.focusKey;
  if (!key) return null;
  const start =
    active instanceof HTMLInputElement && active.type === 'text' ? active.selectionStart : null;
  return { key, start };
}

export function restoreFocus(captured: { key: string; start: number | null } | null): void {
  if (!captured) return;
  const target = document.querySelector(`[data-focus-key="${captured.key}"]`) as HTMLElement | null;
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement && captured.start !== null && target.type === 'text') {
    target.setSelectionRange(captured.start, captured.start);
  }
}

export function focusFirst(container: HTMLElement): void {
  const focusable = focusableIn(container);
  const field = focusable.find(
    (node) => node instanceof HTMLInputElement || node instanceof HTMLSelectElement,
  );
  (field ?? focusable[0])?.focus();
}

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

/** Tab and Shift+Tab wrap inside the container; Escape asks to close. */
export function trapFocus(container: HTMLElement, close: () => void): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableIn(container);
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
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
