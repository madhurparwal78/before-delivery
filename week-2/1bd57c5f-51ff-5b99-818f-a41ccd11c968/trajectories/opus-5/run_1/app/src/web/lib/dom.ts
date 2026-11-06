export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg(tag: string, attrs: Attrs = {}, children: Node[] = []): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function option(value: string, label: string): HTMLOptionElement {
  return el('option', { value }, [label]);
}

export function button(
  label: string,
  attrs: Attrs = {},
  onClick?: (event: MouseEvent) => void,
): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attrs }, [label]);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Eases in quickly and settles gently, as every motion in the product does. */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function animate(
  durationMs: number,
  step: (progress: number) => void,
): () => void {
  if (prefersReducedMotion()) {
    step(1);
    return () => undefined;
  }
  const started = performance.now();
  let frame = 0;
  const tick = (now: number): void => {
    const progress = Math.min(1, (now - started) / durationMs);
    step(easeOut(progress));
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/** Keeps Tab and Shift+Tab cycling inside a dialog or sheet. */
export function trapFocus(root: HTMLElement): (event: KeyboardEvent) => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const items = focusableIn(root);
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
  root.addEventListener('keydown', handler);
  return handler;
}

export type Dialog = {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
};

let openDialogs = 0;

export function openDialog(
  label: string,
  build: (dialog: Dialog) => void,
  opener: HTMLElement | null,
): Dialog {
  const body = el('div', { class: 'dialogbody' });
  const root = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, [
    el('div', { class: 'dialogpanel' }, [el('h2', { class: 'dialogtitle' }, [label]), body]),
  ]);
  const dialog: Dialog = {
    root,
    body,
    close: () => {
      root.remove();
      openDialogs = Math.max(0, openDialogs - 1);
      opener?.focus();
    },
  };
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      dialog.close();
    }
  });
  trapFocus(root);
  build(dialog);
  document.body.append(root);
  openDialogs += 1;
  if (!prefersReducedMotion()) {
    root.classList.add('fading');
    requestAnimationFrame(() => root.classList.remove('fading'));
  }
  const first = focusableIn(root)[0];
  first?.focus();
  return dialog;
}

export function hasOpenDialog(): boolean {
  return openDialogs > 0;
}

export function labelledField(
  label: string,
  attrs: Attrs = {},
  tag: 'input' | 'textarea' = 'input',
): { wrap: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement; error: HTMLElement } {
  const id = `f${Math.random().toString(36).slice(2, 10)}`;
  const input =
    tag === 'input'
      ? el('input', { id, type: 'text', ...attrs })
      : el('textarea', { id, ...attrs });
  const error = el('p', { class: 'fielderror', id: `${id}-error` });
  const wrap = el('div', { class: 'field' }, [el('label', { for: id }, [label]), input, error]);
  return { wrap, input, error };
}

export function setFieldError(
  error: HTMLElement,
  input: HTMLElement,
  message: string | null,
): void {
  error.textContent = message ?? '';
  if (message === null) input.removeAttribute('aria-describedby');
  else input.setAttribute('aria-describedby', error.id);
}

export function money(amount: string): string {
  const negative = amount.startsWith('-');
  const digits = negative ? amount.slice(1) : amount;
  const [whole, fraction] = digits.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${grouped}.${fraction ?? '00'}`;
}
