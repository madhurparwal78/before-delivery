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
  node.replaceChildren();
}

export function labelledInput(options: {
  name: string;
  type?: string;
  value?: string;
  id?: string;
  autocomplete?: string;
  className?: string;
}): { wrapper: HTMLElement; input: HTMLInputElement } {
  const id = options.id ?? `field-${Math.random().toString(36).slice(2, 10)}`;
  const input = el('input', {
    id,
    type: options.type ?? 'text',
    value: options.value ?? '',
    autocomplete: options.autocomplete ?? 'off',
    class: 'field-input',
  });
  const wrapper = el('div', { class: `field ${options.className ?? ''}` }, [
    el('label', { for: id, text: options.name, class: 'field-label' }),
    input,
  ]);
  return { wrapper, input };
}

export interface SpinOptions {
  name: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  shiftStep?: number;
  decimals?: number;
  disabled?: boolean;
  description?: string;
  focusKey?: string;
  onCommit: (value: number) => void;
}

export function spinbutton(options: SpinOptions): {
  wrapper: HTMLElement;
  input: HTMLInputElement;
} {
  const id = `spin-${Math.random().toString(36).slice(2, 10)}`;
  const decimals = options.decimals ?? 3;
  const input = el('input', {
    id,
    type: 'text',
    role: 'spinbutton',
    inputmode: 'decimal',
    class: 'field-input numeric',
    value: formatSpin(options.value, decimals),
    'aria-valuenow': String(options.value),
    'aria-valuemin': options.min === undefined ? null : String(options.min),
    'aria-valuemax': options.max === undefined ? null : String(options.max),
    'data-focus-key': options.focusKey ?? null,
  });
  if (options.disabled) {
    input.setAttribute('aria-disabled', 'true');
    input.readOnly = true;
    if (options.description) input.title = options.description;
  }
  const step = options.step ?? 1;
  const shiftStep = options.shiftStep ?? step * 10;
  const commit = (value: number): void => {
    if (options.disabled) return;
    options.onCommit(value);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = (event.shiftKey ? shiftStep : step) * (event.key === 'ArrowUp' ? 1 : -1);
      const current = Number(input.value);
      const base = Number.isFinite(current) ? current : options.value;
      commit(roundStep(base + delta, decimals));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const value = Number(input.value);
      if (Number.isFinite(value)) commit(value);
    }
  });
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (Number.isFinite(value) && value !== options.value) commit(value);
    else input.value = formatSpin(options.value, decimals);
  });
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id, text: options.name, class: 'field-label' }),
    input,
  ]);
  return { wrapper, input };
}

function roundStep(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatSpin(value: number, decimals: number): string {
  const rounded = roundStep(value, decimals);
  return String(rounded === 0 ? 0 : rounded);
}

export function switchControl(options: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  description?: string;
  focusKey?: string;
  onChange: (checked: boolean) => void;
}): HTMLButtonElement {
  const button = el('button', {
    type: 'button',
    role: 'switch',
    class: 'switch',
    'aria-checked': options.checked ? 'true' : 'false',
    'aria-label': options.name,
    'data-focus-key': options.focusKey ?? null,
  }, [el('span', { class: 'switch-track' }), el('span', { class: 'switch-text', text: options.name })]);
  if (options.disabled) {
    button.setAttribute('aria-disabled', 'true');
    if (options.description) {
      button.title = options.description;
      button.setAttribute('aria-description', options.description);
    }
  }
  button.addEventListener('click', () => {
    if (options.disabled) return;
    options.onChange(button.getAttribute('aria-checked') !== 'true');
  });
  return button;
}

export function combobox(options: {
  name: string;
  value: string;
  choices: { value: string; label: string }[];
  disabled?: boolean;
  description?: string;
  focusKey?: string;
  onChange: (value: string) => void;
}): { wrapper: HTMLElement; select: HTMLSelectElement } {
  const id = `combo-${Math.random().toString(36).slice(2, 10)}`;
  const select = el('select', { id, class: 'field-input', 'data-focus-key': options.focusKey ?? null });
  for (const choice of options.choices) {
    const option = el('option', { value: choice.value, text: choice.label });
    if (choice.value === options.value) option.selected = true;
    select.append(option);
  }
  if (options.disabled) {
    select.setAttribute('aria-disabled', 'true');
    select.disabled = true;
    if (options.description) select.title = options.description;
  }
  select.addEventListener('change', () => options.onChange(select.value));
  const wrapper = el('div', { class: 'field' }, [
    el('label', { for: id, text: options.name, class: 'field-label' }),
    select,
  ]);
  return { wrapper, select };
}

export function radiogroup(options: {
  name: string;
  value: string;
  choices: { value: string; label: string }[];
  disabled?: boolean;
  description?: string;
  focusKeyPrefix?: string;
  onChange: (value: string) => void;
}): HTMLElement {
  const group = el('div', { role: 'radiogroup', 'aria-label': options.name, class: 'radiogroup' });
  for (const choice of options.choices) {
    const radio = el('button', {
      type: 'button',
      role: 'radio',
      class: 'radio',
      'aria-checked': choice.value === options.value ? 'true' : 'false',
      'aria-label': choice.label,
      text: choice.label,
      'data-focus-key': options.focusKeyPrefix ? `${options.focusKeyPrefix}:${choice.value}` : null,
    });
    if (options.disabled) {
      radio.setAttribute('aria-disabled', 'true');
      if (options.description) radio.title = options.description;
    }
    radio.addEventListener('click', () => {
      if (options.disabled) return;
      options.onChange(choice.value);
    });
    group.append(radio);
  }
  return group;
}

export function button(options: {
  label: string;
  className?: string;
  disabled?: boolean;
  description?: string;
  onClick: (event: MouseEvent) => void;
}): HTMLButtonElement {
  const node = el('button', {
    type: 'button',
    class: options.className ?? 'button',
    'aria-label': options.label,
    text: options.label,
  });
  if (options.disabled) {
    node.setAttribute('aria-disabled', 'true');
    if (options.description) {
      node.title = options.description;
      node.setAttribute('aria-description', options.description);
    }
  }
  node.addEventListener('click', (event) => {
    if (options.disabled) return;
    options.onClick(event);
  });
  return node;
}

export function iconButton(options: {
  label: string;
  icon: string;
  className?: string;
  disabled?: boolean;
  description?: string;
  onClick: (event: MouseEvent) => void;
}): HTMLButtonElement {
  const node = el('button', {
    type: 'button',
    class: `icon-button ${options.className ?? ''}`,
    'aria-label': options.label,
    title: options.label,
  }, [el('span', { class: 'icon', html: options.icon, 'aria-hidden': 'true' })]);
  if (options.disabled) {
    node.setAttribute('aria-disabled', 'true');
    if (options.description) {
      node.title = options.description;
      node.setAttribute('aria-description', options.description);
    }
  }
  node.addEventListener('click', (event) => {
    if (options.disabled) return;
    options.onClick(event);
  });
  return node;
}

/** Traps Tab inside a dialog and restores focus when it closes. */
export function openDialog(options: {
  name: string;
  content: (close: () => void) => Node;
  opener: HTMLElement | null;
}): void {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name, class: 'dialog' });
  const close = (): void => {
    backdrop.remove();
    options.opener?.focus();
  };
  dialog.append(options.content(close));
  backdrop.append(dialog);
  document.body.append(backdrop);
  const focusables = (): HTMLElement[] =>
    [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')].filter(
      (node) => !node.hasAttribute('disabled'),
    );
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
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
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  focusables()[0]?.focus();
}

/** A menu whose Escape and Tab behaviour returns focus to its opener. */
export function openMenu(options: {
  name: string;
  items: { label: string; onSelect: () => void }[];
  opener: HTMLElement;
}): void {
  const existing = document.querySelector('.menu-layer');
  existing?.remove();
  const layer = el('div', { class: 'menu-layer' });
  const menu = el('div', { role: 'menu', 'aria-label': options.name, class: 'menu' });
  const close = (): void => {
    layer.remove();
    options.opener.focus();
  };
  for (const item of options.items) {
    const entry = el('button', {
      type: 'button',
      role: 'menuitem',
      class: 'menu-item',
      text: item.label,
      'aria-label': item.label,
    });
    entry.addEventListener('click', () => {
      close();
      item.onSelect();
    });
    menu.append(entry);
  }
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
      items[(next + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === 'Tab') {
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  layer.append(menu);
  layer.addEventListener('mousedown', (event) => {
    if (event.target === layer) close();
  });
  document.body.append(layer);
  const rect = options.opener.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - size.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - size.height - 8))}px`;
  menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}
