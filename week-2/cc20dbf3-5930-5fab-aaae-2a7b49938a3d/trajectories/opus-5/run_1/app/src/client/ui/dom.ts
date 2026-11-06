type Attributes = Record<string, string | number | boolean | null>;

export type Child = Node | string | null;

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === false) continue;
    if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function text(tag: keyof HTMLElementTagNameMap, className: string, value: string): HTMLElement {
  return element(tag, { class: className }, [value]);
}

/** A boxed section with an accessible name, used for every named region. */
export function region(name: string, children: readonly Child[] = []): HTMLElement {
  return element('section', { class: 'box', 'aria-label': name }, children);
}

export function liveRegion(name: string): HTMLElement {
  return element('div', { role: 'status', 'aria-live': 'polite', 'aria-label': name });
}

export function labelledField(
  labelText: string,
  control: HTMLElement,
  errorId: string,
): HTMLElement {
  const id = control.id;
  return element('div', { class: 'field' }, [
    element('label', { class: 'label', for: id }, [labelText]),
    control,
    element('div', { class: 'field-error', id: errorId }),
  ]);
}

export function setFieldError(errorId: string, controlId: string, message: string | null): void {
  const errorNode = document.getElementById(errorId);
  const control = document.getElementById(controlId);
  if (errorNode === null || control === null) return;
  errorNode.textContent = message ?? '';
  if (message === null) control.removeAttribute('aria-describedby');
  else control.setAttribute('aria-describedby', errorId);
}

export function announce(name: string, message: string): void {
  const node = document.querySelector(`[role="status"][aria-label="${name}"]`);
  if (node !== null) node.textContent = message;
}

export interface PendingHandle {
  release(): void;
}

/** Shows the pending copy over a static hatched fill and ignores further presses. */
export function markPending(button: HTMLButtonElement, pendingCopy: string): PendingHandle {
  const original = button.textContent ?? '';
  const wasDisabled = button.disabled;
  button.textContent = pendingCopy;
  button.disabled = true;
  button.classList.add('pending');
  return {
    release(): void {
      button.textContent = original;
      button.disabled = wasDisabled;
      button.classList.remove('pending');
    },
  };
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** One orange underline sweep on an arrived row. */
export function sweep(node: HTMLElement): void {
  node.classList.remove('arrived');
  void node.offsetWidth;
  node.classList.add('arrived');
  window.setTimeout(() => node.classList.remove('arrived'), 600);
}
