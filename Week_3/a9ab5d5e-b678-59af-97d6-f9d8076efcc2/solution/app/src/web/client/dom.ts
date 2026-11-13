type Attributes = Record<string, string | number | boolean | undefined | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'value' && node instanceof HTMLInputElement) node.value = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.append(child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.firstChild.remove();
}

export function labelled(
  labelText: string,
  control: HTMLElement,
  options: { hint?: string } = {},
): HTMLElement {
  const id = `field-${Math.random().toString(36).slice(2, 10)}`;
  control.id = id;
  const label = el('label', { for: id, text: labelText, class: 'field-label' });
  const error = el('p', { class: 'field-error', role: 'none' });
  error.hidden = true;
  const wrap = el('div', { class: 'field' }, [label, control, error]);
  if (options.hint) wrap.append(el('p', { class: 'field-hint', text: options.hint }));
  return wrap;
}

export function fieldError(control: HTMLElement, message: string | null): void {
  const wrap = control.closest('.field');
  const error = wrap?.querySelector('.field-error') as HTMLElement | null;
  if (!error) return;
  if (message === null) {
    error.hidden = true;
    error.textContent = '';
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
    return;
  }
  if (!error.id) error.id = `error-${Math.random().toString(36).slice(2, 10)}`;
  error.textContent = message;
  error.hidden = false;
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', error.id);
}

export function textbox(name: string, options: { value?: string; inputmode?: string } = {}): HTMLInputElement {
  return el('input', {
    type: 'text',
    'aria-label': name,
    value: options.value ?? '',
    inputmode: options.inputmode,
    autocomplete: 'off',
  });
}

export function pendingButton(button: HTMLButtonElement, pending: boolean, pendingText: string): void {
  if (pending) {
    if (!button.dataset.restText) button.dataset.restText = button.textContent ?? '';
    button.setAttribute('aria-disabled', 'true');
    button.textContent = pendingText;
    return;
  }
  button.removeAttribute('aria-disabled');
  if (button.dataset.restText !== undefined) {
    button.textContent = button.dataset.restText;
    delete button.dataset.restText;
  }
}

export function isPending(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-disabled') === 'true';
}

/** Keeps Tab and Shift+Tab inside a modal dialog. */
export function trapFocus(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusable = [...dialog.querySelectorAll<HTMLElement>('input, button, select, textarea, [tabindex="0"]')].filter(
    (node) => !node.hasAttribute('disabled') && node.offsetParent !== null,
  );
  if (focusable.length === 0) return;
  const first = focusable[0] as HTMLElement;
  const last = focusable[focusable.length - 1] as HTMLElement;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface Keyed {
  key: string;
  /** Changes whenever what the node shows changes; an unchanged node is left exactly where it is. */
  signature: string;
  build(): HTMLElement;
}

/**
 * Brings the children of `parent` in line with `entries` without replacing a node whose signature is
 * unchanged, so a background refresh never remounts a control or takes focus from it.
 * Returns the keys that were not there before.
 */
export function reconcile(parent: HTMLElement, entries: Keyed[]): string[] {
  const existing = new Map<string, HTMLElement>();
  for (const child of [...parent.children] as HTMLElement[]) {
    if (child.dataset.key) existing.set(child.dataset.key, child);
  }
  const added: string[] = [];
  const wanted = entries.map((entry) => {
    const kept = existing.get(entry.key);
    if (kept && kept.dataset.signature === entry.signature) return kept;
    const node = entry.build();
    node.dataset.key = entry.key;
    node.dataset.signature = entry.signature;
    if (!kept) added.push(entry.key);
    return node;
  });
  for (const child of [...parent.children]) {
    if (!wanted.includes(child as HTMLElement)) child.remove();
  }
  wanted.forEach((node, index) => {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
  });
  return added;
}

const stickerArt =
  '<svg viewBox="0 0 96 96" width="96" height="96" focusable="false"><path d="M48 6l9 7 11-3 6 10 11 2 1 11 9 6-4 11 4 11-9 6-1 11-11 2-6 10-11-3-9 7-9-7-11 3-6-10-11-2-1-11-9-6 4-11-4-11 9-6 1-11 11-2 6-10 11 3z" fill="currentColor" stroke="#15110f" stroke-width="5" stroke-linejoin="round"/><path d="M32 50l11 11 22-24" fill="none" stroke="#15110f" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** An empty state: one large display line over one drawn sticker. */
export function emptyState(text: string): HTMLElement {
  const art = el('span', { class: 'empty-sticker', 'aria-hidden': 'true' });
  art.innerHTML = stickerArt;
  return el('div', { class: 'empty-state' }, [el('p', { class: 'empty-line', text }), art]);
}
