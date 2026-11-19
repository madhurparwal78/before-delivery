export type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

const EVENTS = new Set([
  'click',
  'input',
  'change',
  'keydown',
  'keyup',
  'submit',
  'focus',
  'blur',
  'focusout',
  'pointerdown',
  'dragstart',
  'dragover',
  'drop',
  'dragend',
  'paste',
]);

export function h(
  tag: string,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (EVENTS.has(key) && typeof value === 'function') {
      node.addEventListener(key, value);
      continue;
    }
    if (key === 'text') {
      node.textContent = String(value);
      continue;
    }
    if (key === 'html') continue;
    if (key === 'value' && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
      node.value = String(value);
      continue;
    }
    node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function qs<T extends HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return qsa<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    root,
  ).filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhone(): boolean {
  return window.innerWidth < 768;
}

/**
 * Every dialog keeps Tab inside while open, closes on Escape and returns focus
 * to the control that opened it.
 */
export type OpenDialog = { root: HTMLElement; close: () => void };

let openDialog: OpenDialog | null = null;

export function dialog(
  name: string,
  build: (close: () => void) => (Node | string | null)[],
  opener: HTMLElement | null,
  options: { onEscape?: () => boolean } = {},
): OpenDialog {
  const backdrop = h('div', { class: 'backdrop' });
  const panel = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': name, class: 'dialog' });
  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    openDialog = null;
    if (opener && document.contains(opener)) opener.focus();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!document.contains(panel)) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      if (options.onEscape && options.onEscape()) return;
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables(panel);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  for (const child of build(close)) if (child) panel.append(typeof child === 'string' ? document.createTextNode(child) : child);
  backdrop.append(panel);
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  if (prefersReducedMotion()) backdrop.classList.add('instant');

  const field = qs<HTMLElement>('input, textarea, select', panel);
  const target = field ?? focusables(panel)[0];
  if (target) target.focus();
  openDialog = { root: panel, close };
  return openDialog;
}

/** Menus: ArrowDown/ArrowUp move, Enter activates, Escape closes and returns focus. */
export function menu(
  button: HTMLElement,
  items: { label: string; run: () => void; disabled?: boolean }[],
): void {
  const existing = qs<HTMLElement>('.menu-pop');
  if (existing) existing.remove();
  const pop = h('div', { role: 'menu', class: 'menu-pop' });
  const nodes = items.map((item) =>
    h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        tabindex: '-1',
        class: 'menu-item',
        click: () => {
          close(false);
          item.run();
        },
      },
      [item.label],
    ),
  );
  let index = 0;
  const close = (restoreFocus: boolean): void => {
    pop.remove();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    if (restoreFocus && document.contains(button)) button.focus();
  };
  const onOutside = (event: Event): void => {
    if (!pop.contains(event.target as Node) && event.target !== button) close(false);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      index =
        event.key === 'ArrowDown'
          ? (index + 1) % nodes.length
          : (index - 1 + nodes.length) % nodes.length;
      nodes[index].focus();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const next = event.shiftKey
        ? (index - 1 + nodes.length) % nodes.length
        : (index + 1) % nodes.length;
      index = next;
      nodes[index].focus();
    }
  };
  for (const node of nodes) pop.append(node);
  button.insertAdjacentElement('afterend', pop);
  if (prefersReducedMotion()) pop.classList.add('instant');
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onOutside, true);
  if (nodes.length > 0) nodes[0].focus();
}

export function announce(region: string, text: string): void {
  const node = qs<HTMLElement>(`[data-live="${region}"]`);
  if (!node) return;
  node.textContent = '';
  window.setTimeout(() => {
    node.textContent = text;
  }, 20);
}

export function showAlert(host: HTMLElement, text: string): HTMLElement {
  const existing = qs<HTMLElement>(':scope > [role="alert"]', host);
  if (existing) existing.remove();
  const node = h('p', { role: 'alert', class: 'alert', text });
  host.append(node);
  return node;
}

export function clearAlerts(host: HTMLElement): void {
  for (const node of qsa<HTMLElement>('[role="alert"]', host)) node.remove();
}
