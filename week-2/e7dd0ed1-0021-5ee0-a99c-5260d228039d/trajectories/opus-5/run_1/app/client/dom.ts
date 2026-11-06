export type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | boolean | null | undefined> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (value === true) {
      node.setAttribute(name, '');
      continue;
    }
    node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svgEl(tag: string, attributes: Record<string, string | number> = {}, children: Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function replace(node: Element, children: Child[]): void {
  clear(node);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function button(
  label: string,
  options: { className?: string; focusKey?: string; disabled?: boolean; onClick?: () => void } = {},
): HTMLButtonElement {
  const node = el('button', {
    type: 'button',
    class: options.className ?? '',
    'data-focus-key': options.focusKey ?? null,
    disabled: options.disabled === true,
  });
  node.textContent = label;
  if (options.onClick) node.addEventListener('click', options.onClick);
  return node;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface Dialog {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
  setStatus: (text: string) => void;
}

/** Opens a modal dialog that keeps focus inside and returns focus to its opener on close. */
export function openDialog(options: { name: string; opener: HTMLElement | null; build: (dialog: Dialog) => void }): Dialog {
  const openerKey = options.opener?.getAttribute('data-focus-key') ?? null;
  const overlay = el('div', { class: 'overlay' });
  const body = el('div', { class: 'dialog-body' });
  const alert = el('p', { class: 'dialog-alert', role: 'alert' });
  const root = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name }, [body, alert]);
  overlay.append(root);

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    const target = openerKey ? document.querySelector<HTMLElement>(`[data-focus-key="${openerKey}"]`) : options.opener;
    if (target) target.focus();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!overlay.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const dialog: Dialog = {
    root,
    body,
    close,
    setStatus: (text: string) => {
      alert.textContent = text;
    },
  };
  options.build(dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKeyDown, true);
  if (!prefersReducedMotion()) root.classList.add('enter');
  const first = root.querySelector<HTMLElement>(focusableSelector);
  if (first) first.focus();
  return dialog;
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const id = `f${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const children: Child[] = [el('label', { for: id, text: label })];
  if (hint) {
    const hintId = `${id}-hint`;
    children.push(el('p', { class: 'hint', id: hintId, text: hint }));
    input.setAttribute('aria-describedby', hintId);
  }
  children.push(input);
  children.push(el('p', { class: 'field-error', 'data-error-for': id }));
  return el('div', { class: 'field' }, children);
}

export function setFieldError(container: HTMLElement, input: HTMLElement, message: string | null): void {
  const target = container.querySelector(`[data-error-for="${input.id}"]`);
  if (target) target.textContent = message ?? '';
}

export function textbox(label: string, options: { type?: string; value?: string; readOnly?: boolean; placeholder?: string } = {}): HTMLInputElement {
  const input = el('input', {
    type: options.type ?? 'text',
    'aria-label': label,
    value: options.value ?? '',
    readonly: options.readOnly === true,
    placeholder: options.placeholder ?? null,
  });
  if (options.value !== undefined) input.value = options.value;
  return input;
}

export function statusRegion(name: string): HTMLElement {
  return el('p', { class: 'status', role: 'status', 'aria-label': name, 'data-status': name });
}

export function setStatus(region: HTMLElement | null, text: string): void {
  if (region && region.textContent !== text) region.textContent = text;
}
