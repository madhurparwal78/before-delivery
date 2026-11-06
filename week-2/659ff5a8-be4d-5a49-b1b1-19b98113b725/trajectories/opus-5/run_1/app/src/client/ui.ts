import { RequestFailed } from './api';
import { announce, el } from './dom';

export function liveRegion(name: string, kind: 'status' | 'alert' = 'status'): HTMLElement {
  return el('div', {
    class: 'live-region',
    attrs: {
      role: kind,
      'aria-live': kind === 'alert' ? 'assertive' : 'polite',
      'aria-label': name,
    },
  });
}

export function formatInZone(iso: string, timeZone: string): { date: string; time: string } {
  const instant = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const read = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  const hour = read('hour') === '24' ? '00' : read('hour');
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${hour}:${read('minute')}`,
  };
}

export function localDateTime(local: string): { date: string; time: string } {
  const [date, time] = local.split('T');
  return { date: date ?? '', time: (time ?? '').slice(0, 5) };
}

export interface ActionOptions<T> {
  control: HTMLButtonElement | HTMLElement;
  region: HTMLElement | null;
  pending: string;
  run: () => Promise<T>;
  success: (result: T) => string;
  failure: (error: RequestFailed) => string;
}

/** Runs an async action with the published pending state and live-region announcement. */
export async function runAction<T>(options: ActionOptions<T>): Promise<T | null> {
  const control = options.control;
  const button = control instanceof HTMLButtonElement ? control : null;
  if (button) button.disabled = true;
  control.classList.add('is-pending');
  announce(options.region, options.pending);
  try {
    const result = await options.run();
    announce(options.region, options.success(result));
    return result;
  } catch (error) {
    if (error instanceof RequestFailed) {
      announce(options.region, options.failure(error));
      return null;
    }
    throw error;
  } finally {
    if (button) button.disabled = false;
    control.classList.remove('is-pending');
  }
}

export function labelledField(options: {
  label: string;
  id: string;
  type?: string;
  value?: string;
  required?: boolean;
  inputMode?: string;
  min?: string;
  max?: string;
  step?: string;
  hint?: string;
}): { wrapper: HTMLElement; input: HTMLInputElement } {
  const input = el('input', {
    class: 'field__input',
    attrs: {
      id: options.id,
      name: options.id,
      type: options.type ?? 'text',
      value: options.value ?? '',
      ...(options.required ? { required: 'required' } : {}),
      ...(options.inputMode ? { inputmode: options.inputMode } : {}),
      ...(options.min !== undefined ? { min: options.min } : {}),
      ...(options.max !== undefined ? { max: options.max } : {}),
      ...(options.step !== undefined ? { step: options.step } : {}),
    },
  });
  const error = el('p', { class: 'field__error', attrs: { id: `${options.id}-error` } });
  const wrapper = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', text: options.label, attrs: { for: options.id } }),
    input,
    options.hint ? el('p', { class: 'field__hint', text: options.hint }) : null,
    error,
  );
  return { wrapper, input };
}

export function setFieldError(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, message: string): void {
  const error = input.parentElement?.querySelector<HTMLElement>('.field__error');
  if (error) error.textContent = message;
  if (message.length > 0) {
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', `${input.id}-error`);
  } else {
    input.removeAttribute('aria-invalid');
  }
}

export function labelledSelect(options: {
  label: string;
  id: string;
  options: { value: string; label: string }[];
  value?: string;
}): { wrapper: HTMLElement; select: HTMLSelectElement } {
  const select = el(
    'select',
    { class: 'field__input', attrs: { id: options.id, name: options.id } },
    options.options.map((option) =>
      el('option', {
        text: option.label,
        attrs: {
          value: option.value,
          ...(options.value === option.value ? { selected: 'selected' } : {}),
        },
      }),
    ),
  );
  const error = el('p', { class: 'field__error', attrs: { id: `${options.id}-error` } });
  const wrapper = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', text: options.label, attrs: { for: options.id } }),
    select,
    error,
  );
  return { wrapper, select };
}

export function labelledTextarea(options: {
  label: string;
  id: string;
  rows?: number;
}): { wrapper: HTMLElement; textarea: HTMLTextAreaElement } {
  const textarea = el('textarea', {
    class: 'field__input',
    attrs: { id: options.id, name: options.id, rows: options.rows ?? 3 },
  });
  const error = el('p', { class: 'field__error', attrs: { id: `${options.id}-error` } });
  const wrapper = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', text: options.label, attrs: { for: options.id } }),
    textarea,
    error,
  );
  return { wrapper, textarea };
}

export function button(
  label: string,
  options: { variant?: 'primary' | 'secondary'; onClick: () => void; disabled?: boolean } ,
): HTMLButtonElement {
  return el('button', {
    class: `button button--${options.variant ?? 'secondary'}`,
    text: label,
    attrs: { type: 'button', ...(options.disabled ? { disabled: 'disabled' } : {}) },
    on: { click: options.onClick },
  });
}

export interface FormAlert {
  element: HTMLElement;
  message: (text: string) => void;
  fields: (entries: { message: string; focus: () => void }[]) => void;
  reset: () => void;
}

/** One alert per form: either a sentence or the `Fix these fields` list. */
export function formAlert(): FormAlert {
  const element = el('div', { class: 'form-alert', attrs: { role: 'alert' } });
  const reset = (): void => {
    element.textContent = '';
  };
  return {
    element,
    reset,
    message: (text: string) => {
      element.textContent = text;
    },
    fields: (entries) => {
      reset();
      if (entries.length === 0) return;
      element.appendChild(el('h3', { text: 'Fix these fields' }));
      element.appendChild(
        el(
          'ul',
          {},
          entries.map((entry) =>
            el(
              'li',
              {},
              el('a', {
                text: entry.message,
                attrs: { href: '#' },
                on: {
                  click: (event: Event) => {
                    event.preventDefault();
                    entry.focus();
                  },
                },
              }),
            ),
          ),
        ),
      );
    },
  };
}

