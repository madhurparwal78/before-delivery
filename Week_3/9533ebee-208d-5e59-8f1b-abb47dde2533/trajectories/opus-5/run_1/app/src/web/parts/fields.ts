/**
 * Amount, price, percentage and desk-time fields. Browser-side checks run on
 * every input and show their message under the field as its description; a
 * refused submission moves focus to the first field in error.
 */

import { FIELD_ERROR } from '../../domain/copy.ts';
import {
  parseAmountInput,
  parsePercentInput,
  parsePriceInput,
  type AmountProblem,
} from '../../domain/deskformat.ts';
import { parseDeskWallTime } from '../../domain/desktime.ts';
import { el, setText } from '../dom.ts';

let fieldCounter = 0;

export type FieldKind =
  | { readonly kind: 'amount'; readonly decimals: () => number }
  | { readonly kind: 'price' }
  | { readonly kind: 'percent' }
  | { readonly kind: 'deskTime'; readonly zone: () => string };

export class Field {
  readonly input: HTMLInputElement;
  readonly row: HTMLElement;
  private readonly description: HTMLElement;
  private readonly spec: FieldKind;
  readonly label: string;

  constructor(label: string, spec: FieldKind, options: { placeholder?: string } = {}) {
    fieldCounter += 1;
    const id = `field-${fieldCounter}`;
    this.label = label;
    this.spec = spec;
    this.input = el('input', {
      id,
      type: 'text',
      class: 'field-input figure',
      'aria-label': label,
      autocomplete: 'off',
      inputmode: spec.kind === 'deskTime' ? 'text' : 'decimal',
      ...(options.placeholder === undefined ? {} : { placeholder: options.placeholder }),
    });
    this.description = el('span', { id: `${id}-error`, class: 'field-error' });
    this.row = el('div', { class: 'field' }, [
      el('label', { for: id, class: 'label', text: label }),
      this.input,
      this.description,
    ]);
    this.input.addEventListener('input', () => this.validate());
  }

  get value(): string {
    return this.input.value;
  }

  set value(next: string) {
    this.input.value = next;
  }

  /** The message this field's own rules produce, or null when it is good. */
  private check(): string | null {
    const raw = this.input.value;
    if (raw.trim() === '') return null;
    switch (this.spec.kind) {
      case 'amount': {
        const parsed = parseAmountInput(raw, this.spec.decimals());
        return parsed.ok ? null : amountMessage(parsed.problem, this.spec.decimals());
      }
      case 'price': {
        const parsed = parsePriceInput(raw);
        return parsed.ok ? null : amountMessage(parsed.problem, 8);
      }
      case 'percent': {
        return parsePercentInput(raw).ok ? null : FIELD_ERROR.percent;
      }
      case 'deskTime': {
        const parsed = parseDeskWallTime(raw, this.spec.zone());
        if (parsed.ok) return null;
        return parsed.problem === 'gap' ? FIELD_ERROR.deskTimeGap : FIELD_ERROR.deskTimeShape;
      }
    }
  }

  /** Shows or clears the field error at once, as the member types. */
  validate(): boolean {
    const message = this.check();
    this.show(message);
    return message === null;
  }

  /** True when the field holds a usable value. */
  get ready(): boolean {
    return this.input.value.trim() !== '' && this.check() === null;
  }

  /** A message the server named for this field. */
  show(message: string | null): void {
    if (message === null) {
      this.input.removeAttribute('aria-invalid');
      this.input.removeAttribute('aria-describedby');
      setText(this.description, '');
      return;
    }
    this.input.setAttribute('aria-invalid', 'true');
    this.input.setAttribute('aria-describedby', this.description.id);
    setText(this.description, message);
  }

  get hasError(): boolean {
    return this.input.getAttribute('aria-invalid') === 'true';
  }

  focus(): void {
    this.input.focus();
  }

  /** Pressing Enter in an amount field presses that field's own button. */
  submitsWith(button: HTMLButtonElement): void {
    this.input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      button.click();
    });
  }
}

function amountMessage(problem: AmountProblem, decimals: number): string {
  if (problem === 'decimals') return FIELD_ERROR.amountDecimals(decimals);
  if (problem === 'zero') return FIELD_ERROR.amountZero;
  return FIELD_ERROR.amountShape;
}

/**
 * Applies a 422's field messages, moves focus to the first field in error and
 * returns the fields it marked.
 */
export function applyFieldErrors(
  fields: ReadonlyArray<{ name: string; field: Field }>,
  errors: Readonly<Record<string, string>>,
): Array<{ name: string; label: string; focus: () => void }> {
  const marked: Array<{ name: string; label: string; focus: () => void }> = [];
  for (const entry of fields) {
    const message = errors[entry.name];
    if (message === undefined) {
      entry.field.show(null);
      continue;
    }
    entry.field.show(message);
    marked.push({
      name: entry.name,
      label: entry.field.label,
      focus: () => entry.field.focus(),
    });
  }
  if (marked[0] !== undefined) {
    const first = fields.find((entry) => entry.name === marked[0]?.name);
    first?.field.focus();
  }
  return marked;
}

export function button(label: string, extra: Record<string, string> = {}): HTMLButtonElement {
  return el('button', { type: 'button', class: 'action', text: label, ...extra });
}

/**
 * Runs an action with its button disabled, as the pending state requires, and
 * gives the button its focus back afterwards. Disabling a focused control
 * would otherwise drop focus to the document, and focus never moves on
 * success.
 */
export async function whilePending<T>(
  pressed: HTMLButtonElement,
  work: () => Promise<T>,
): Promise<T> {
  const hadFocus = document.activeElement === pressed;
  pressed.disabled = true;
  try {
    return await work();
  } finally {
    pressed.disabled = false;
    if (hadFocus) pressed.focus();
  }
}
