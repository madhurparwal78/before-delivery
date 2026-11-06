type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attributes);
  for (const child of children) node.append(child);
  return node;
}

export function svg(tag: string, attributes: Attributes = {}, children: Element[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(name, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function apply(node: HTMLElement, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) {
      node.removeAttribute(name);
      continue;
    }
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (name === 'class') {
      node.className = String(value);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function focusables(container: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="option"]';
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node.getAttribute('role') === 'option',
  );
}

/** Keeps Tab and Shift+Tab inside a dialog or picker. */
export function trapTab(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = focusables(container);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export type Dialog = { element: HTMLElement; close: () => void };

let openDialogs = 0;

/** Every dialog traps Tab, closes on Escape and returns focus where it came from. */
export function openDialog(options: {
  name: string;
  build: (body: HTMLElement, dialog: Dialog) => void;
  onClose?: () => void;
  returnFocus?: HTMLElement | null;
}): Dialog {
  const opener =
    options.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const overlay = el('div', { class: 'overlay' });
  const element = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name });
  overlay.append(element);
  let closed = false;
  const dialog: Dialog = {
    element,
    close() {
      if (closed) return;
      closed = true;
      openDialogs -= 1;
      overlay.remove();
      document.removeEventListener('keydown', onKeydown, true);
      options.onClose?.();
      if (opener !== null && document.contains(opener)) opener.focus();
    },
  };
  function onKeydown(event: KeyboardEvent): void {
    if (!overlay.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return;
    }
    trapTab(element, event);
  }
  options.build(element, dialog);
  document.body.append(overlay);
  openDialogs += 1;
  document.addEventListener('keydown', onKeydown, true);
  const first = focusables(element)[0];
  if (first !== undefined) first.focus();
  return dialog;
}

export type PickerOption = { label: string; value: string };

/** A listbox picker: arrow keys move, Enter chooses, Escape closes, focus returns. */
export function openPicker(options: {
  name: string;
  anchor: HTMLElement;
  options: PickerOption[];
  onChoose: (value: string) => void;
  onClose?: () => void;
}): { close: () => void; element: HTMLElement; anchor: HTMLElement } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : options.anchor;
  const element = el('div', { class: 'picker', role: 'listbox', 'aria-label': options.name });
  let closed = false;
  const picker = {
    element,
    anchor: options.anchor,
    close() {
      if (closed) return;
      closed = true;
      element.remove();
      document.removeEventListener('keydown', onKeydown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      options.onClose?.();
      if (document.contains(opener)) opener.focus();
    },
  };
  const items = options.options.map((option) => {
    const node = el('div', { class: 'option', role: 'option', tabindex: '-1', text: option.label });
    node.addEventListener('click', () => {
      options.onChoose(option.value);
      picker.close();
    });
    return node;
  });
  for (const item of items) element.append(item);

  function onKeydown(event: KeyboardEvent): void {
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      picker.close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      items[Math.min(index + 1, items.length - 1)]?.focus();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      items[Math.max(index - 1, 0)]?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      const option = options.options[index];
      if (option !== undefined) {
        options.onChoose(option.value);
        picker.close();
      }
      return;
    }
    trapTab(element, event);
  }
  function onPointerDown(event: PointerEvent): void {
    if (!element.contains(event.target as Node)) picker.close();
  }

  document.body.append(element);
  position(element, options.anchor);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  items[0]?.focus();
  return picker;
}

/** Keeps a picker inside the viewport, including on the last row of a long list. */
export function position(element: HTMLElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const size = element.getBoundingClientRect();
  const margin = 4;
  let top = box.bottom + margin;
  if (top + size.height > window.innerHeight - margin) {
    top = Math.max(margin, box.top - size.height - margin);
  }
  if (size.height > window.innerHeight - 2 * margin) top = margin;
  let left = box.left;
  if (left + size.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - size.width - margin);
  element.style.top = `${Math.round(top)}px`;
  element.style.left = `${Math.round(left)}px`;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
