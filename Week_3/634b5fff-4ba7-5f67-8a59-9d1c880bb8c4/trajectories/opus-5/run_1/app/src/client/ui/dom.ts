type Attributes = Record<string, string | number | boolean | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) continue;
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
  while (node.firstChild !== null) node.firstChild.remove();
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export interface TrapOptions {
  onEscape: () => void;
}

/** Tab and Shift+Tab wrap inside an open dialog or sheet; Escape closes it. */
export function trapFocus(root: HTMLElement, options: TrapOptions): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      options.onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const order = focusables(root);
    if (order.length === 0) return;
    const first = order[0] as HTMLElement;
    const last = order[order.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}

export function field(
  name: string,
  type: 'text' | 'email' | 'tel' = 'text',
  extra: Attributes = {},
): { wrapper: HTMLLabelElement; input: HTMLInputElement; error: HTMLElement } {
  const input = el('input', { type, 'aria-label': name, name, ...extra });
  const error = el('span', { class: 'field-error' });
  const wrapper = el('label', { class: 'field' }, [el('span', { text: name }), input, error]);
  return { wrapper, input, error };
}

export function textareaField(
  name: string,
  extra: Attributes = {},
): { wrapper: HTMLLabelElement; input: HTMLTextAreaElement; error: HTMLElement } {
  const input = el('textarea', { 'aria-label': name, name, rows: 3, ...extra });
  const error = el('span', { class: 'field-error' });
  const wrapper = el('label', { class: 'field' }, [el('span', { text: name }), input, error]);
  return { wrapper, input, error };
}

export function wideScreen(): boolean {
  return window.innerWidth >= 768;
}
