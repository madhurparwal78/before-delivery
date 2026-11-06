export type Child = Node | string | number | null | undefined | Child[];

export interface ElementOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null>;
  on?: Partial<{
    [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void;
  }>;
}

function append(parent: HTMLElement, child: Child): void {
  if (child === null || child === undefined) return;
  if (Array.isArray(child)) {
    for (const item of child) append(parent, item);
    return;
  }
  if (typeof child === 'string' || typeof child === 'number') {
    parent.appendChild(document.createTextNode(String(child)));
    return;
  }
  parent.appendChild(child);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value === null || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, handler] of Object.entries(options.on ?? {})) {
    node.addEventListener(name, handler as EventListener);
  }
  for (const child of children) append(node, child);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function replace(node: HTMLElement, ...children: Child[]): void {
  clear(node);
  for (const child of children) append(node, child);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function announce(region: HTMLElement | null, message: string): void {
  if (!region) return;
  region.textContent = message;
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export interface DialogHandle {
  root: HTMLElement;
  close: () => void;
}

export function openDialog(options: {
  name: string;
  heading: string;
  build: (close: () => void) => Child[];
  onClose?: () => void;
}): DialogHandle {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const panel = el(
    'div',
    {
      class: prefersReducedMotion() ? 'dialog dialog--static' : 'dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name },
    },
    el('h2', { class: 'dialog__heading', text: options.heading }),
  );
  const close = (): void => {
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    options.onClose?.();
    opener?.focus();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!backdrop.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(panel);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };
  for (const child of options.build(close)) append(panel, child);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKeyDown, true);
  const first = focusables(panel)[0];
  first?.focus();
  return { root: panel, close };
}
