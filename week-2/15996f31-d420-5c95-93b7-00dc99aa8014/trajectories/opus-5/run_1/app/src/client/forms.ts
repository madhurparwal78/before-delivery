import { clear, el } from './core';

let fieldSequence = 0;

export type FieldKind = 'text' | 'number' | 'select' | 'checkbox' | 'file' | 'textarea';

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  value?: string;
  hint?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  min?: number;
  max?: number;
  step?: string;
  accept?: string;
  autocomplete?: string;
  inputmode?: string;
  password?: boolean;
}

export class FormField {
  readonly name: string;
  readonly label: string;
  readonly wrapper: HTMLElement;
  readonly control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  private readonly message: HTMLElement;
  private readonly controlId: string;

  constructor(spec: FieldSpec) {
    fieldSequence += 1;
    this.name = spec.name;
    this.label = spec.label;
    this.controlId = `field-${fieldSequence}`;
    const messageId = `${this.controlId}-error`;
    const hintId = `${this.controlId}-hint`;
    this.message = el('p', { class: 'field__error', id: messageId });

    if (spec.kind === 'select') {
      const select = el('select', { id: this.controlId, class: 'field__control' });
      for (const option of spec.options ?? []) {
        select.append(el('option', { value: option.value, text: option.label }));
      }
      if (spec.value !== undefined) select.value = spec.value;
      this.control = select;
    } else if (spec.kind === 'textarea') {
      const area = el('textarea', { id: this.controlId, class: 'field__control', rows: 3 });
      area.value = spec.value ?? '';
      this.control = area;
    } else {
      const type =
        spec.kind === 'number'
          ? 'number'
          : spec.kind === 'checkbox'
            ? 'checkbox'
            : spec.kind === 'file'
              ? 'file'
              : spec.password === true
                ? 'password'
                : 'text';
      const input = el('input', {
        id: this.controlId,
        class: spec.kind === 'checkbox' ? 'field__check' : 'field__control',
        type,
        ...(spec.min === undefined ? {} : { min: spec.min }),
        ...(spec.max === undefined ? {} : { max: spec.max }),
        ...(spec.step === undefined ? {} : { step: spec.step }),
        ...(spec.accept === undefined ? {} : { accept: spec.accept }),
        ...(spec.autocomplete === undefined ? {} : { autocomplete: spec.autocomplete }),
        ...(spec.inputmode === undefined ? {} : { inputmode: spec.inputmode }),
      });
      if (spec.value !== undefined) input.value = spec.value;
      this.control = input;
    }

    const describedBy = [spec.hint === undefined ? null : hintId, messageId]
      .filter((value): value is string => value !== null)
      .join(' ');
    this.control.setAttribute('aria-describedby', describedBy);

    const labelNode = el('label', { for: this.controlId, text: spec.label, class: 'field__label' });
    const parts: Node[] =
      spec.kind === 'checkbox' ? [this.control, labelNode] : [labelNode, this.control];
    if (spec.hint !== undefined) {
      parts.push(el('p', { class: 'field__hint', id: hintId, text: spec.hint }));
    }
    parts.push(this.message);
    this.wrapper = el(
      'div',
      { class: `field field--${spec.kind}`, 'data-field': spec.name },
      parts,
    );
  }

  get id(): string {
    return this.controlId;
  }

  get value(): string {
    return this.control.value.trim();
  }

  get checked(): boolean {
    return this.control instanceof HTMLInputElement && this.control.checked;
  }

  get files(): FileList | null {
    return this.control instanceof HTMLInputElement ? this.control.files : null;
  }

  setValue(value: string): void {
    this.control.value = value;
  }

  setOptions(options: ReadonlyArray<{ value: string; label: string }>): void {
    if (!(this.control instanceof HTMLSelectElement)) return;
    this.control.replaceChildren();
    for (const option of options) {
      this.control.append(el('option', { value: option.value, text: option.label }));
    }
  }

  clearFile(): void {
    if (this.control instanceof HTMLInputElement) this.control.value = '';
  }

  setMax(max: number): void {
    this.control.setAttribute('max', String(max));
  }

  setError(message: string | null): void {
    this.message.textContent = message ?? '';
    if (message === null) {
      this.control.removeAttribute('aria-invalid');
      this.wrapper.dataset.invalid = 'false';
    } else {
      this.control.setAttribute('aria-invalid', 'true');
      this.wrapper.dataset.invalid = 'true';
    }
  }

  focus(): void {
    this.control.focus();
  }
}

export class ErrorSummary {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;

  constructor() {
    this.list = el('ul', { class: 'summary__list' });
    this.element = el('div', { class: 'summary', tabindex: '-1', hidden: true }, [
      el('h3', { class: 'summary__heading', text: 'There is a problem' }),
      this.list,
    ]);
  }

  /** Lists one link per field message and takes focus. */
  show(messages: ReadonlyArray<{ field: FormField; message: string }>): void {
    clear(this.list);
    for (const entry of messages) {
      const link = el('a', { href: `#${entry.field.id}`, text: entry.message });
      link.addEventListener('click', (event) => {
        event.preventDefault();
        entry.field.focus();
      });
      this.list.append(el('li', {}, [link]));
    }
    this.element.hidden = false;
    this.element.focus();
  }

  hide(): void {
    this.element.hidden = true;
    clear(this.list);
  }
}

/** Shows server field messages next to each field and in the summary. */
export function applyFieldMessages(
  fields: readonly FormField[],
  summary: ErrorSummary,
  messages: Record<string, string>,
): void {
  const shown: Array<{ field: FormField; message: string }> = [];
  for (const field of fields) {
    const message = messages[field.name];
    field.setError(message ?? null);
    if (message !== undefined) shown.push({ field, message });
  }
  const unmatched = Object.entries(messages).filter(
    ([name]) => !fields.some((field) => field.name === name),
  );
  const firstField = fields[0];
  if (firstField !== undefined) {
    for (const [, message] of unmatched) shown.push({ field: firstField, message });
  }
  if (shown.length > 0) summary.show(shown);
  else summary.hide();
}
