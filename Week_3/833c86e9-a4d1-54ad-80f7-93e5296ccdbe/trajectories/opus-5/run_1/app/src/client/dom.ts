export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: (Node | string | null)[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function applyAttrs(node: HTMLElement, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function money(minor: number, currency: string, text: string, attrs: Attrs = {}): HTMLElement {
  return el('span', { ...attrs, 'data-minor': minor, 'data-currency': currency }, [text]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export interface DialogOptions {
  role?: 'dialog' | 'alertdialog';
  name: string;
  opener: HTMLElement | null;
  escapes?: boolean;
  sheet?: string;
  onClose?: () => void;
  className?: string;
}

export interface DialogHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

const openDialogs: DialogHandle[] = [];

/** A modal dialog or sheet: Tab wraps inside, Escape closes, focus returns. */
export function openDialog(options: DialogOptions, build: (body: HTMLElement, handle: DialogHandle) => void): DialogHandle {
  const body = el('div', { class: 'dialog-body' });
  const root = el(
    'div',
    {
      class: `dialog ${options.className ?? ''}`.trim(),
      role: options.role ?? 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
      'data-sheet': options.sheet ?? null,
    },
    [body],
  );
  const handle: DialogHandle = {
    root,
    body,
    close: () => {
      if (!root.isConnected) return;
      root.remove();
      overlay.remove();
      const index = openDialogs.indexOf(handle);
      if (index >= 0) openDialogs.splice(index, 1);
      document.removeEventListener('keydown', onKeyDown, true);
      options.onClose?.();
      options.opener?.focus();
    },
  };
  const overlay = el('div', { class: 'dialog-overlay' });

  function onKeyDown(event: KeyboardEvent): void {
    if (openDialogs[openDialogs.length - 1] !== handle) return;
    if (event.key === 'Escape' && options.escapes !== false) {
      event.preventDefault();
      event.stopPropagation();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(root);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  document.body.append(overlay, root);
  openDialogs.push(handle);
  build(body, handle);
  const items = focusables(root);
  if (items.length > 0) items[0].focus();
  return handle;
}

export function topDialog(): DialogHandle | null {
  return openDialogs.length > 0 ? openDialogs[openDialogs.length - 1] : null;
}

/** One roving tab stop across a set of controls. */
export function roving(items: HTMLElement[], activeIndex: number): void {
  items.forEach((item, index) => {
    item.tabIndex = index === activeIndex ? 0 : -1;
  });
}

export function announce(region: HTMLElement | null, text: string): void {
  if (!region) return;
  region.textContent = text;
}
