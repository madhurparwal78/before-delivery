/** Every dialog is modal, keeps Tab inside itself and returns focus to its opener. */
import { el, find, trapFocus } from './dom.js';

export interface DialogHandle {
  dialog: HTMLElement;
  close: () => void;
  errorSummary: (errors: Record<string, string>) => void;
}

export function openDialog(title: string, content: (Node | null)[], opener: HTMLElement | null): DialogHandle {
  const body = el('div', { class: 'dialog-body' }, content);
  const dialog = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    el('p', { class: 'dialog-title', text: title }),
    el('div', { class: 'error-summary', 'data-error-summary': '', tabindex: '-1', hidden: true }),
    body,
  ]);
  const backdrop = el('div', { class: 'dialog-backdrop' }, [dialog]);
  document.body.append(backdrop);
  let release: (() => void) | null = null;
  const close = (): void => {
    release?.();
    backdrop.remove();
  };
  release = trapFocus(dialog, opener, close);
  return {
    dialog,
    close,
    errorSummary: (errors) => {
      const summary = find<HTMLElement>('[data-error-summary]', dialog);
      if (summary === null) return;
      summary.replaceChildren();
      const entries = Object.entries(errors);
      if (entries.length === 0) {
        summary.hidden = true;
        return;
      }
      summary.hidden = false;
      summary.append(el('p', { text: 'Check the highlighted fields.' }));
      for (const [field, copy] of entries) {
        const link = el('a', { href: `#field-${field}`, text: copy });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          find<HTMLElement>(`#field-${field}`, dialog)?.focus();
        });
        summary.append(link);
        const fieldError = find<HTMLElement>(`[data-field-error="${field}"]`, dialog);
        if (fieldError !== null) fieldError.textContent = copy;
      }
      summary.focus();
    },
  };
}

export function textField(
  id: string,
  label: string,
  options: { value?: string; multiline?: boolean; readonly?: boolean } = {},
): HTMLElement {
  const control = options.multiline === true
    ? el('textarea', { id: `field-${id}`, rows: '3', readonly: options.readonly === true })
    : el('input', { id: `field-${id}`, type: 'text', value: options.value ?? '', readonly: options.readonly === true });
  if (options.multiline === true && options.value !== undefined) control.textContent = options.value;
  return el('div', { class: 'field' }, [
    el('label', { for: `field-${id}`, text: label }),
    control,
    el('p', { class: 'field-error', 'data-field-error': id }),
  ]);
}

export function selectField(id: string, label: string, options: string[], value?: string): HTMLElement {
  const select = el(
    'select',
    { id: `field-${id}` },
    options.map((option) => el('option', { value: option, text: option, selected: option === value })),
  );
  return el('div', { class: 'field' }, [
    el('label', { for: `field-${id}`, text: label }),
    select,
    el('p', { class: 'field-error', 'data-field-error': id }),
  ]);
}

export function fieldValue(dialog: HTMLElement, id: string): string {
  const node = find<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#field-${id}`, dialog);
  return node === null ? '' : node.value;
}
