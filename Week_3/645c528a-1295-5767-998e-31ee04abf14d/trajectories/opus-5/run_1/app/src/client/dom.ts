export interface ElementOptions {
  className?: string;
  text?: string;
  id?: string;
  attrs?: Record<string, string | number | boolean | null>;
  on?: Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>;
  children?: (Node | string | null | undefined)[];
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, options: ElementOptions = {}): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value === null || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (options.on) {
    for (const [type, listener] of Object.entries(options.on)) {
      if (listener) node.addEventListener(type, listener as EventListener);
    }
  }
  for (const child of options.children ?? []) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function statusRegion(name: string, className = 'notice'): HTMLElement {
  return el('p', { className, attrs: { role: 'status', 'aria-label': name, 'aria-live': 'polite' } });
}

export function labelledButton(
  name: string,
  onClick: () => void,
  options: { className?: string; disabled?: boolean; children?: (Node | string)[]; attrs?: Record<string, string | number | boolean | null> } = {},
): HTMLButtonElement {
  const button = el('button', {
    className: options.className ?? 'button',
    attrs: { type: 'button', 'aria-label': name, ...(options.attrs ?? {}) },
    children: options.children ?? [name],
    on: {
      click: (event) => {
        event.preventDefault();
        onClick();
      },
    },
  });
  if (options.disabled) button.disabled = true;
  return button;
}

export function sliderInput(options: {
  name: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onInput: (value: number) => void;
}): HTMLInputElement {
  const input = el('input', {
    className: 'slider',
    attrs: {
      type: 'range',
      min: options.min,
      max: options.max,
      step: options.step,
      'aria-label': options.name,
    },
  });
  input.value = String(options.value);
  input.addEventListener('input', () => options.onInput(Number(input.value)));
  return input;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => !node.hasAttribute('inert') && node.offsetParent !== null,
  );
}

export interface DialogHandle {
  element: HTMLElement;
  close: () => void;
}

export function dialogIsOpen(): boolean {
  return document.querySelector('.backdrop:not(.closing)') !== null;
}

/**
 * Keeps Tab inside a dialog and answers Escape, from the document so the keys
 * still reach it after a pending control takes focus away.
 */
export function attachDialogKeys(dialog: HTMLElement, options: { onEscape?: () => void }): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (!document.contains(dialog)) return;
    if (event.key === 'Escape') {
      if (!options.onEscape) return;
      event.preventDefault();
      event.stopPropagation();
      options.onEscape();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableIn(dialog);
    if (focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    if (!active || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}

/** Every dialog keeps Tab inside it and returns focus to the control that opened it. */
export function openDialog(options: {
  name: string;
  className?: string;
  opener: HTMLElement | null;
  closeOnEscape?: boolean;
  alert?: boolean;
  onClose?: () => void;
  build: (handle: DialogHandle) => (Node | string)[];
}): DialogHandle {
  const backdrop = el('div', { className: 'backdrop' });
  const dialog = el('div', {
    className: `dialog ${options.className ?? ''}`.trim(),
    attrs: { role: options.alert ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-label': options.name },
  });
  let detach = (): void => undefined;
  const handle: DialogHandle = {
    element: dialog,
    close: () => {
      detach();
      backdrop.remove();
      options.onClose?.();
      const opener = options.opener;
      if (opener && document.contains(opener)) opener.focus();
      else document.querySelector<HTMLElement>('h1')?.focus();
    },
  };
  dialog.append(...options.build(handle));
  backdrop.append(dialog);
  document.body.append(backdrop);
  detach = attachDialogKeys(dialog, options.closeOnEscape === false ? {} : { onEscape: () => handle.close() });
  const target = focusableIn(dialog)[0];
  target?.focus();
  return handle;
}

export function appendLogLines(log: HTMLElement, lines: string[]): void {
  const current = log.childElementCount;
  for (let index = current; index < lines.length; index += 1) {
    log.append(el('p', { className: 'log-line', text: lines[index] ?? '' }));
  }
  if (lines.length < current) {
    clear(log);
    for (const line of lines) log.append(el('p', { className: 'log-line', text: line }));
  }
}
