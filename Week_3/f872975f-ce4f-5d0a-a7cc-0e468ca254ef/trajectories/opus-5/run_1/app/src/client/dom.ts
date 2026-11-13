export type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  class?: string;
  text?: string;
  html?: never;
  attrs?: Record<string, string | number | boolean | null>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Child[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class !== undefined) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === false) continue;
    node.setAttribute(name, String(value));
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    if (handler !== undefined) node.addEventListener(name, handler as EventListener);
  }
  append(node, children);
  return node;
}

export function svg(tag: string, attrs: Record<string, string | number> = {}, children: Child[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

let fieldCounter = 0;

/**
 * Pairs a control with its own `label` through `for`, so the control's accessible name is
 * exactly the label text and never picks up a selected option.
 */
export function labelled(labelText: string, control: HTMLElement, className = 'field'): HTMLDivElement {
  if (control.id === '') {
    fieldCounter += 1;
    control.id = `kw-field-${fieldCounter}`;
  }
  const label = el('label', { class: 'field-label', text: labelText, attrs: { for: control.id } });
  const wrapper = el('div', { class: className });
  if (className === 'check') {
    wrapper.appendChild(control);
    wrapper.appendChild(label);
  } else {
    wrapper.appendChild(label);
    wrapper.appendChild(control);
  }
  return wrapper;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export interface DialogHandle {
  root: HTMLElement;
  close(): void;
}

export interface DialogOptions {
  name: string;
  sheet?: boolean;
  opener: HTMLElement | null;
  build(handle: { close(): void }): Child[];
  onClose?(): void;
}

/** A dialog or bottom sheet that traps Tab, closes on Escape and gives focus back to its opener. */
export function openDialog(options: DialogOptions): DialogHandle {
  const layer = el('div', { class: 'dialog-layer' });
  const root = el('div', {
    class: options.sheet === true ? 'dialog sheet' : 'dialog',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name }
  });
  let closed = false;
  const handle: DialogHandle = {
    root,
    close(): void {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyDown, true);
      layer.remove();
      options.onClose?.();
      options.opener?.focus();
    }
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!layer.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusableIn(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  append(root, options.build(handle));
  layer.appendChild(root);
  document.body.appendChild(layer);
  document.addEventListener('keydown', onKeyDown, true);
  const items = focusableIn(root);
  items[0]?.focus();
  return handle;
}

export function isTextField(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node instanceof HTMLTextAreaElement) return true;
  if (node instanceof HTMLInputElement) return !['checkbox', 'radio', 'file', 'button', 'submit'].includes(node.type);
  return node.isContentEditable;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
