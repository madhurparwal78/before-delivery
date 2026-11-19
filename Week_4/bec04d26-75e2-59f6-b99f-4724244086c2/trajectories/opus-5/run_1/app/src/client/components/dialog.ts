import type { App } from '../app';
import { el, focusables, isPhone, prefersReducedMotion } from '../dom';
import { DialogState } from '../state';

export interface DialogSpec {
  title: string;
  content: (HTMLElement | null)[];
  confirmLabel: string;
  sheet?: boolean;
  onConfirm: () => void | Promise<void>;
}

function dialogOf(app: App): DialogState {
  const dialog = app.state.dialog;
  if (!dialog) throw new Error('no dialog open');
  return dialog;
}

function errorFor(dialog: DialogState, name: string): HTMLElement | null {
  const message = dialog.errors[name];
  if (!message) return null;
  return el(
    'span',
    {
      class: 'field-error',
      id: `dialog-${name}-error`,
      'data-field-error': name,
      tabindex: '-1',
    },
    message,
  );
}

function described(dialog: DialogState, name: string, hint: boolean): string | null {
  if (dialog.errors[name]) return `dialog-${name}-error`;
  return hint ? `dialog-${name}-hint` : null;
}

export function textField(
  app: App,
  name: string,
  label: string,
  options: { kind?: 'text' | 'password' | 'email'; hint?: string } = {},
): HTMLElement {
  const dialog = dialogOf(app);
  const id = `dialog-${name}`;
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, label),
    el('input', {
      id,
      type: options.kind ?? 'text',
      value: dialog.fields[name] ?? '',
      'data-focus-key': `dialog:${name}`,
      'aria-invalid': dialog.errors[name] ? 'true' : null,
      'aria-describedby': described(dialog, name, options.hint !== undefined),
      onInput: (event: Event) =>
        app.setDialogField(name, (event.target as HTMLInputElement).value),
    }),
    options.hint ? el('span', { class: 'hint', id: `${id}-hint` }, options.hint) : null,
    errorFor(dialog, name),
  );
}

export function numberField(app: App, name: string, label: string): HTMLElement {
  const dialog = dialogOf(app);
  const id = `dialog-${name}`;
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, label),
    el('input', {
      id,
      type: 'number',
      step: '1',
      value: dialog.fields[name] ?? '',
      'data-focus-key': `dialog:${name}`,
      'aria-invalid': dialog.errors[name] ? 'true' : null,
      'aria-describedby': described(dialog, name, false),
      onInput: (event: Event) =>
        app.setDialogField(name, (event.target as HTMLInputElement).value),
    }),
    errorFor(dialog, name),
  );
}

export function textareaField(
  app: App,
  name: string,
  label: string,
  hint?: string,
): HTMLElement {
  const dialog = dialogOf(app);
  const id = `dialog-${name}`;
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, label),
    el(
      'textarea',
      {
        id,
        rows: 6,
        'data-focus-key': `dialog:${name}`,
        'aria-invalid': dialog.errors[name] ? 'true' : null,
        'aria-describedby': described(dialog, name, hint !== undefined),
        onInput: (event: Event) =>
          app.setDialogField(name, (event.target as HTMLTextAreaElement).value),
      },
      dialog.fields[name] ?? '',
    ),
    hint ? el('span', { class: 'hint', id: `${id}-hint` }, hint) : null,
    errorFor(dialog, name),
  );
}

export function selectField(
  app: App,
  name: string,
  label: string,
  placeholder: string,
  options: readonly { value: string; label: string }[],
): HTMLElement {
  const dialog = dialogOf(app);
  const id = `dialog-${name}`;
  const current = dialog.fields[name] ?? '';
  return el(
    'div',
    { class: 'field' },
    el('label', { for: id }, label),
    el(
      'select',
      {
        id,
        'data-focus-key': `dialog:${name}`,
        'aria-invalid': dialog.errors[name] ? 'true' : null,
        'aria-describedby': described(dialog, name, false),
        onChange: (event: Event) =>
          app.setDialogField(name, (event.target as HTMLSelectElement).value),
      },
      el('option', { value: '', selected: current === '' }, placeholder),
      ...options.map((option) =>
        el('option', { value: option.value, selected: option.value === current }, option.label),
      ),
    ),
    errorFor(dialog, name),
  );
}

export function radioGroupField(
  app: App,
  name: string,
  label: string,
  options: readonly { value: string; label: string }[],
): HTMLElement {
  const dialog = dialogOf(app);
  const current = dialog.fields[name] ?? '';
  return el(
    'div',
    { class: 'field' },
    el(
      'div',
      {
        role: 'radiogroup',
        'aria-label': label,
        'aria-invalid': dialog.errors[name] ? 'true' : null,
        'aria-describedby': described(dialog, name, false),
      },
      el('span', { style: 'display:block;font-weight:500;margin-bottom:0.3rem' }, label),
      ...options.map((option) => {
        const id = `dialog-${name}-${option.value}`;
        return el(
          'div',
          { class: 'row', style: 'gap:0.5rem;align-items:center' },
          el('input', {
            id,
            type: 'radio',
            name: `dialog-${name}`,
            value: option.value,
            checked: option.value === current,
            style: 'width:auto;min-height:auto',
            'data-focus-key': `dialog:${name}:${option.value}`,
            onChange: () => app.setDialogField(name, option.value),
          }),
          el('label', { for: id, style: 'margin:0' }, option.label),
        );
      }),
    ),
    errorFor(dialog, name),
  );
}

export function messageBlock(app: App): HTMLElement | null {
  const dialog = dialogOf(app);
  const message = dialog.errors._message;
  if (!message) return null;
  return el(
    'p',
    { class: 'field-error', 'data-field-error': '_message', tabindex: '-1' },
    message,
  );
}

export function renderDialog(app: App, spec: DialogSpec): HTMLElement {
  const dialog = dialogOf(app);
  const asSheet = spec.sheet === true && isPhone();
  const reduced = prefersReducedMotion();
  const titleId = 'dialog-title';
  const confirm = (): void => {
    if (dialog.saving) return;
    void spec.onConfirm();
  };

  const body = el(
    'div',
    {
      class: `dialog${asSheet ? ' sheet' : ''}${
        asSheet && dialog.entering && !reduced ? ' sheet-entering' : ''
      }${asSheet && dialog.leaving && !reduced ? ' sheet-leaving' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'data-dialog': dialog.kind,
    },
    el('h2', { id: titleId }, spec.title),
    ...spec.content,
    el(
      'div',
      { class: 'dialog-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'primary',
          'data-focus-key': 'dialog:confirm',
          onClick: confirm,
        },
        dialog.saving ? 'Saving' : spec.confirmLabel,
      ),
      el(
        'button',
        { type: 'button', 'data-focus-key': 'dialog:cancel', onClick: () => app.closeDialog() },
        'Cancel',
      ),
    ),
  );

  body.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      app.closeDialog();
      return;
    }
    if (
      event.key === 'Enter' &&
      event.target instanceof HTMLInputElement &&
      event.target.type !== 'radio'
    ) {
      event.preventDefault();
      confirm();
      return;
    }
    if (event.key !== 'Tab') return;
    const stops = focusables(body);
    if (stops.length === 0) return;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return el('div', { class: `scrim${asSheet ? ' sheet-scrim' : ''}` }, body);
}

/** Opens on the first message, else the first field, else the confirm button. */
export function focusDialog(root: HTMLElement): void {
  const message = root.querySelector<HTMLElement>('[data-field-error]');
  if (message) {
    message.focus();
    return;
  }
  const field = root.querySelector<HTMLElement>('input, textarea, select');
  if (field) {
    field.focus();
    return;
  }
  root.querySelector<HTMLElement>('[data-focus-key="dialog:confirm"]')?.focus();
}
