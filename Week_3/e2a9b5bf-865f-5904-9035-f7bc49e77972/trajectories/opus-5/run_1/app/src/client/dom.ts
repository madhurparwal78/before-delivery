export interface ElementOptions {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Record<string, string | null>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Array<Node | string | null> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    if (handler) node.addEventListener(name, handler as EventListener);
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.firstChild.remove();
}

/** Write a status region only when its text actually changes. */
export function setStatus(node: HTMLElement | null, text: string): void {
  if (!node) return;
  if (node.textContent === text) return;
  node.textContent = text;
}

export function labelledField(
  labelText: string,
  control: HTMLElement,
  options: { class?: string } = {},
): HTMLElement {
  const id = control.id || `field-${Math.random().toString(36).slice(2, 10)}`;
  control.id = id;
  const label = el('label', { class: 'field-label', text: labelText, attrs: { for: id } });
  return el('div', { class: options.class ? `field ${options.class}` : 'field' }, [label, control]);
}

export function button(
  name: string,
  options: { class?: string; type?: string } = {},
): HTMLButtonElement {
  return el('button', {
    class: options.class ?? 'button',
    text: name,
    attrs: { type: options.type ?? 'button' },
  });
}

export function select(
  accessibleName: string,
  options: Array<{ value: string; label: string }>,
  value: string | null,
): HTMLSelectElement {
  const node = el('select', { class: 'input', attrs: { 'aria-label': accessibleName } });
  for (const option of options) {
    const item = el('option', { text: option.label, attrs: { value: option.value } });
    if (option.value === value) item.selected = true;
    node.append(item);
  }
  return node;
}

/** Keep Tab and Shift+Tab inside a dialog. */
export function trapFocus(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.hasAttribute('disabled'));
  if (focusable.length === 0) return;
  const first = focusable[0] as HTMLElement;
  const last = focusable[focusable.length - 1] as HTMLElement;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
