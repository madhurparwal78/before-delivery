type Attributes = Record<string, string | number | boolean | null | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else if (name === 'html') node.innerHTML = String(value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild !== null) node.firstChild.remove();
}

export function button(
  label: string,
  onClick: (event: MouseEvent) => void,
  attributes: Attributes = {},
): HTMLButtonElement {
  const node = el('button', { type: 'button', class: 'pill', ...attributes }, [label]);
  node.addEventListener('click', onClick);
  return node;
}

export function field(
  label: string,
  input: HTMLElement,
  options: { hint?: string } = {},
): HTMLElement {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  input.setAttribute('id', id);
  input.setAttribute('aria-label', label);
  const wrap = el('div', { class: 'field' }, [
    el('label', { for: id, text: label }),
    input,
  ]);
  if (options.hint !== undefined) wrap.append(el('p', { class: 'hint', text: options.hint }));
  return wrap;
}

export function fieldError(wrap: Element, message: string | null): void {
  wrap.querySelector('.field-error')?.remove();
  if (message === null) return;
  wrap.append(el('p', { class: 'field-error', text: message }));
}

export function textbox(label: string, options: Attributes = {}): HTMLInputElement {
  const input = el('input', { type: 'text', 'aria-label': label, ...options });
  return input;
}

export function spinbutton(label: string, value: number, options: Attributes = {}): HTMLInputElement {
  return el('input', {
    type: 'number',
    role: 'spinbutton',
    'aria-label': label,
    value: String(value),
    ...options,
  });
}

export function combobox(
  label: string,
  options: { value: string; label: string }[],
  selected?: string,
): HTMLSelectElement {
  const select = el('select', { 'aria-label': label });
  for (const option of options) {
    select.append(
      el('option', { value: option.value, selected: option.value === selected }, [option.label]),
    );
  }
  return select;
}

export function checkbox(label: string, checked = false): HTMLInputElement {
  return el('input', { type: 'checkbox', 'aria-label': label, checked });
}

/** Tab and Shift+Tab wrap inside a dialog, Escape closes, focus returns to the opener. */
export function trapDialog(dialog: HTMLElement, close: () => void): () => void {
  const opener = document.activeElement as HTMLElement | null;
  const focusable = (): HTMLElement[] =>
    [
      ...dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((node) => !node.hasAttribute('disabled'));
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener('keydown', onKey);
  const items = focusable();
  if (items.length > 0) items[0].focus();
  return () => {
    dialog.removeEventListener('keydown', onKey);
    if (opener !== null && document.body.contains(opener)) opener.focus();
  };
}

/** Rebuilding a list keeps the keyboard where it was. */
export function keepingFocus(container: HTMLElement, rebuild: () => void, refocus: () => void): void {
  const had = container.contains(document.activeElement);
  rebuild();
  if (had) refocus();
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
