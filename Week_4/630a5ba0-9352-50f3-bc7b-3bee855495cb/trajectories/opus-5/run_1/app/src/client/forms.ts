import { el } from './dom.js';

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export interface Field {
  wrapper: HTMLElement;
  input: HTMLInputElement;
  showError: (message: string | null) => void;
}

export function textField(
  label: string,
  options: { type?: string; value?: string; autocomplete?: string; readonly?: boolean } = {},
): Field {
  const id = nextId('field');
  const errorId = `${id}-error`;
  const input = el('input', {
    id,
    type: options.type ?? 'text',
    value: options.value ?? '',
    autocomplete: options.autocomplete ?? null,
    readonly: options.readonly ?? null,
  });
  const error = el('span', { class: 'error', id: errorId, hidden: true });
  const wrapper = el('div', { class: 'field' }, [el('label', { for: id, text: label }), input, error]);
  return {
    wrapper,
    input,
    showError: (message) => {
      if (message === null) {
        error.hidden = true;
        error.textContent = '';
        input.removeAttribute('aria-describedby');
        input.removeAttribute('aria-invalid');
        return;
      }
      error.hidden = false;
      error.textContent = message;
      input.setAttribute('aria-describedby', errorId);
      input.setAttribute('aria-invalid', 'true');
    },
  };
}

export interface SelectField {
  wrapper: HTMLElement;
  select: HTMLSelectElement;
  showError: (message: string | null) => void;
}

export function timeZoneField(label = 'Time zone', selected?: string): SelectField {
  const id = nextId('zone');
  const errorId = `${id}-error`;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const value = selected ?? browserZone;
  const zones = zoneList(value);
  const select = el(
    'select',
    { id },
    zones.map((zone) => el('option', { value: zone, selected: zone === value ? true : null, text: zone })),
  );
  const error = el('span', { class: 'error', id: errorId, hidden: true });
  const wrapper = el('div', { class: 'field' }, [el('label', { for: id, text: label }), select, error]);
  return {
    wrapper,
    select,
    showError: (message) => {
      if (message === null) {
        error.hidden = true;
        error.textContent = '';
        select.removeAttribute('aria-describedby');
        return;
      }
      error.hidden = false;
      error.textContent = message;
      select.setAttribute('aria-describedby', errorId);
    },
  };
}

function zoneList(selected: string): string[] {
  const supported =
    'supportedValuesOf' in Intl
      ? (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone')
      : [];
  const zones = supported.length > 0 ? [...supported] : [...FALLBACK_ZONES];
  if (!zones.includes(selected)) zones.unshift(selected);
  return zones;
}

const FALLBACK_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
];

export function numberField(
  label: string,
  options: { value: number; min: number; max: number; step: number },
): Field {
  const id = nextId('number');
  const errorId = `${id}-error`;
  const input = el('input', {
    id,
    type: 'number',
    value: String(options.value),
    min: options.min,
    max: options.max,
    step: options.step,
  });
  const error = el('span', { class: 'error', id: errorId, hidden: true });
  const wrapper = el('div', { class: 'field' }, [el('label', { for: id, text: label }), input, error]);
  return {
    wrapper,
    input,
    showError: (message) => {
      if (message === null) {
        error.hidden = true;
        error.textContent = '';
        input.removeAttribute('aria-describedby');
        return;
      }
      error.hidden = false;
      error.textContent = message;
      input.setAttribute('aria-describedby', errorId);
    },
  };
}

export function pending(button: HTMLButtonElement, copy: string | null, idle: string): void {
  if (copy === null) {
    button.removeAttribute('aria-busy');
    button.disabled = false;
    button.textContent = idle;
    return;
  }
  button.setAttribute('aria-busy', 'true');
  button.disabled = true;
  button.textContent = copy;
}
