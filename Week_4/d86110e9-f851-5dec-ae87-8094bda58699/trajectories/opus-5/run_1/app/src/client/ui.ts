import { focusableWithin, h } from './dom';

export const VIEWER_REASON = 'Viewers cannot change this workspace';
export const OWNER_REASON = 'Only owners can do this';

let reasonSeq = 0;

/** A control that is present but disabled carries its reason as an accessible description. */
export function withReason(control: HTMLElement, reason: string | null): HTMLElement {
  if (reason === null) return control;
  control.setAttribute('disabled', '');
  reasonSeq += 1;
  const id = `reason-${reasonSeq}`;
  control.setAttribute('aria-describedby', id);
  return h('span', { class: 'with-reason' }, control, h('span', { id, class: 'visually-hidden', text: reason }));
}

export interface ActionOptions {
  variant?: 'primary' | 'secondary';
  reason?: string | null;
  className?: string;
}

/** While a request is in flight the button is disabled, aria-busy and reads Working... */
export function actionButton(
  label: string,
  run: () => Promise<void>,
  options: ActionOptions = {},
): { button: HTMLButtonElement; element: HTMLElement } {
  const button = h('button', {
    type: 'button',
    class: `pill pill-${options.variant ?? 'secondary'} ${options.className ?? ''}`,
    text: label,
    'aria-label': label,
  });
  button.addEventListener('click', () => {
    if (button.hasAttribute('disabled')) return;
    button.setAttribute('disabled', '');
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Working...';
    void run().finally(() => {
      button.removeAttribute('disabled');
      button.removeAttribute('aria-busy');
      button.textContent = label;
    });
  });
  return { button, element: withReason(button, options.reason ?? null) };
}

export function statusChip(status: string, extra = ''): HTMLElement {
  return h('span', { class: `chip chip-${status} ${extra}`.trim(), text: status });
}

export function labelledInput(
  label: string,
  type: 'text' | 'password' | 'email' | 'number' | 'textarea' | 'select',
  options: { value?: string; name?: string; choices?: string[]; disabled?: string | null } = {},
): { wrapper: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement } {
  let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (type === 'textarea') {
    input = h('textarea', { class: 'input', 'aria-label': label, rows: 4 });
    input.value = options.value ?? '';
  } else if (type === 'select') {
    input = h(
      'select',
      { class: 'input', 'aria-label': label },
      ...(options.choices ?? []).map((choice) =>
        h('option', { value: choice, selected: choice === options.value, text: choice }),
      ),
    );
    input.value = options.value ?? '';
  } else {
    input = h('input', { class: 'input', type, 'aria-label': label });
    input.value = options.value ?? '';
  }
  const field = withReason(input, options.disabled ?? null);
  const wrapper = h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), field);
  return { wrapper, input };
}

export function problemAlert(message: string, focus: () => void): HTMLElement {
  return h(
    'div',
    { role: 'alert', 'aria-label': 'Problem', class: 'panel panel-dark alert-panel' },
    h('a', {
      class: 'link-action',
      href: '#',
      text: message,
      onclick: (event: Event) => {
        event.preventDefault();
        focus();
      },
    }),
  );
}

interface DialogOptions {
  name: string;
  build: (close: () => void) => HTMLElement;
  /** Resolved when the dialog closes, so a repaint behind it cannot lose the focus. */
  returnFocus: HTMLElement | (() => HTMLElement | null) | null;
  focusSelector?: string;
}

let openDialogElement: HTMLElement | null = null;

function closeAnyDialog(): void {
  openDialogElement?.remove();
  openDialogElement = null;
}

export function openDialog(options: DialogOptions): HTMLElement {
  closeAnyDialog();
  const layer = h('div', { class: 'dialog-layer' });
  const close = (): void => {
    layer.remove();
    openDialogElement = null;
    const target = typeof options.returnFocus === 'function' ? options.returnFocus() : options.returnFocus;
    target?.focus();
  };
  const dialog = h(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': options.name, class: 'dialog panel panel-dark' },
    options.build(close),
  );
  dialog.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableWithin(dialog);
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
  });
  layer.append(dialog);
  document.body.append(layer);
  openDialogElement = layer;
  const target =
    options.focusSelector === undefined ? null : dialog.querySelector<HTMLElement>(options.focusSelector);
  if (target !== null) target.focus();
  else focusableWithin(dialog)[0]?.focus();
  return dialog;
}

export function expander(
  heading: string,
  open: boolean,
  build: () => HTMLElement,
): HTMLElement {
  const body = h('div', { class: 'expander-body' }, build());
  const button = h('button', {
    type: 'button',
    class: 'expander-heading',
    text: heading,
    'aria-expanded': open ? 'true' : 'false',
  });
  body.hidden = !open;
  if (open) body.classList.add('fade-in');
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    body.hidden = expanded;
    if (!expanded) body.classList.add('fade-in');
  });
  return h('div', { class: 'expander' }, button, body);
}

export function jsonGroup(label: string, value: unknown): HTMLElement {
  return h(
    'div',
    { role: 'group', 'aria-label': label, class: 'json-group' },
    h('p', { class: 'group-label', text: label }),
    h('pre', { class: 'json-text', text: JSON.stringify(value === undefined ? null : value, null, 2) ?? 'null' }),
  );
}

