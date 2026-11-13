type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'value' && node instanceof HTMLInputElement) node.value = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function button(
  label: string,
  attrs: Attrs,
  onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attrs }, [label]);
  node.addEventListener('click', (event) => onClick(event as MouseEvent));
  return node;
}

export function focusIn(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export interface DialogHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: (options?: { restoreFocus?: boolean }) => void;
}

/** Every dialog traps Tab, closes on Escape and gives focus back to its opener. */
export function openDialog(options: {
  name: string;
  opener: HTMLElement | null;
  onCancel?: () => void;
}): DialogHandle {
  const body = el('div', { class: 'dialog-body' });
  const root = el('div', { class: 'dialog-layer' }, [
    el('div', { class: 'dialog-scrim' }),
    el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name }, [
      body,
    ]),
  ]);
  const dialog = root.querySelector<HTMLElement>('.dialog') as HTMLElement;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handle.close();
      options.onCancel?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusIn(dialog);
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

  const handle: DialogHandle = {
    root,
    body,
    close: (closeOptions = {}) => {
      root.removeEventListener('keydown', onKeyDown);
      root.remove();
      if (closeOptions.restoreFocus !== false) options.opener?.focus();
    },
  };
  root.addEventListener('keydown', onKeyDown);
  document.body.append(root);
  return handle;
}

export function focusFirstField(handle: DialogHandle): void {
  const focusable = focusIn(handle.body);
  focusable[0]?.focus();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
