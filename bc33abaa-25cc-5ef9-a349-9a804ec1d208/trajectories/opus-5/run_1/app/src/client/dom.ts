export type Attrs = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(root: Element, ...children: (Node | null)[]): void {
  clear(root);
  for (const child of children) {
    if (child) root.append(child);
  }
}

export function field(
  label: string,
  input: HTMLElement,
  options: { hint?: string } = {},
): HTMLElement {
  const id = input.id || `field-${Math.random().toString(36).slice(2, 10)}`;
  input.id = id;
  const errorId = `${id}-error`;
  const error = el('p', { class: 'field-error', id: errorId, role: 'status' });
  const wrap = el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    input,
    options.hint ? el('p', { class: 'field-hint', text: options.hint }) : null,
    error,
  ]);
  return wrap;
}

export function setFieldError(input: HTMLElement, message: string | null): void {
  const wrap = input.closest('.field');
  const error = wrap?.querySelector('.field-error');
  if (!error) return;
  error.textContent = message ?? '';
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-errormessage', error.id);
  } else {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-errormessage');
  }
}

export function clearFieldErrors(form: HTMLElement): void {
  for (const error of form.querySelectorAll('.field-error')) error.textContent = '';
  for (const input of form.querySelectorAll('[aria-invalid]')) {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-errormessage');
  }
}

export function applyFieldErrors(
  form: HTMLElement,
  errors: Record<string, string>,
): string | null {
  let unmatched: string | null = null;
  for (const [path, message] of Object.entries(errors)) {
    const name = path.split('.').pop() ?? path;
    const input = form.querySelector<HTMLElement>(
      `[name="${CSS.escape(path)}"], [name="${CSS.escape(name)}"]`,
    );
    if (input) setFieldError(input, message);
    else unmatched = message;
  }
  return unmatched;
}

let dialogStack: { dialog: HTMLElement; opener: HTMLElement | null }[] = [];

export function openDialog(
  dialog: HTMLElement,
  opener: HTMLElement | null,
  options: { alert?: boolean } = {},
): void {
  dialog.setAttribute('role', options.alert ? 'alertdialog' : 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  document.body.append(dialog);
  dialogStack.push({ dialog, opener });
  const focusable = dialog.querySelector<HTMLElement>(
    '[data-initial-focus], button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  focusable?.focus();
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(dialog);
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [
      ...dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((item) => !item.hasAttribute('disabled'));
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function closeDialog(dialog: HTMLElement): void {
  const entry = dialogStack.find((item) => item.dialog === dialog);
  dialogStack = dialogStack.filter((item) => item.dialog !== dialog);
  dialog.remove();
  entry?.opener?.focus();
}

export function announce(region: Element | null, message: string): void {
  if (!region) return;
  region.textContent = message;
}
