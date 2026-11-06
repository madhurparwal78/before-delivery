import { clear, el, focus, setFieldError } from './dom.js';
import { copy } from './copy.js';

export type LiveRegion = { announce(message: string): void; node: HTMLElement };

/** The named live region of a screen. */
export function liveRegion(name: string): LiveRegion {
  const node = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': name, class: 'live-region' });
  return {
    node,
    announce(message: string): void {
      node.textContent = '';
      window.setTimeout(() => {
        node.textContent = message;
      }, 30);
    },
  };
}

export type ProblemsSummary = {
  node: HTMLElement;
  show(errors: Record<string, string>, fieldIds: Record<string, string>, scope: ParentNode): void;
  hide(scope: ParentNode, fieldIds: Record<string, string>): void;
};

/** One link per field error; its text is that error and it focuses the field. */
export function problemsSummary(): ProblemsSummary {
  const list = el('ul', { class: 'problems-list' });
  const heading = el('h2', { class: 'problems-heading' });
  const node = el('section', { 'aria-label': 'Problems', class: 'problems', hidden: true }, [heading, list]);
  return {
    node,
    show(errors, fieldIds, scope): void {
      const entries = Object.entries(errors);
      heading.textContent = copy.problemsHeading(entries.length);
      clear(list);
      for (const [field, message] of entries) {
        const id = fieldIds[field];
        const link = el('a', { href: `#${id ?? ''}`, text: message });
        link.addEventListener('click', (event) => {
          event.preventDefault();
          focus(scope.querySelector<HTMLElement>(`#${id}`));
        });
        list.append(el('li', {}, [link]));
        if (id) setFieldError(scope, id, message);
      }
      node.hidden = entries.length === 0;
    },
    hide(scope, fieldIds): void {
      node.hidden = true;
      clear(list);
      for (const id of Object.values(fieldIds)) setFieldError(scope, id, null);
    },
  };
}

export type PendingButton = { start(): void; stop(): void };

/** Pending copy on the button itself; the single ellipsis character, never three stops. */
export function pending(button: HTMLButtonElement, pendingCopy: string): PendingButton {
  const original = button.textContent ?? '';
  return {
    start(): void {
      button.disabled = true;
      button.textContent = pendingCopy;
    },
    stop(): void {
      button.disabled = false;
      button.textContent = original;
    },
  };
}

export function textbox(options: {
  id: string;
  label: string;
  value?: string;
  type?: string;
  autocomplete?: string;
  inputmode?: string;
  multiline?: boolean;
  describedBy?: string;
}): { field: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement } {
  const input = options.multiline
    ? el('textarea', { class: 'input', rows: 5 })
    : el('input', { class: 'input', type: options.type ?? 'text' });
  if (!options.multiline && options.autocomplete) input.setAttribute('autocomplete', options.autocomplete);
  if (options.inputmode) input.setAttribute('inputmode', options.inputmode);
  input.value = options.value ?? '';
  const field = el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: options.id, text: options.label }),
    input,
    el('p', { class: 'field-error', id: `${options.id}-error`, hidden: true }),
  ]);
  input.id = options.id;
  if (options.describedBy) input.setAttribute('aria-describedby', options.describedBy);
  return { field, input };
}

export function radioGroup(options: {
  name: string;
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  onChange?: (value: string) => void;
}): { node: HTMLElement; value(): string; set(value: string): void } {
  const inputs: HTMLInputElement[] = [];
  const node = el('div', { role: 'radiogroup', 'aria-label': options.label, class: 'radiogroup' });
  for (const choice of options.choices) {
    const id = `${options.name}-${choice.value}`;
    const input = el('input', { type: 'radio', name: options.name, id, value: choice.value, class: 'radio' });
    input.checked = choice.value === options.value;
    input.addEventListener('change', () => {
      if (input.checked && options.onChange) options.onChange(choice.value);
    });
    inputs.push(input);
    node.append(el('div', { class: 'radio-row' }, [input, el('label', { for: id, text: choice.label })]));
  }
  return {
    node,
    value(): string {
      return inputs.find((input) => input.checked)?.value ?? options.value;
    },
    set(value: string): void {
      for (const input of inputs) input.checked = input.value === value;
    },
  };
}

export function select(options: {
  id: string;
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  onChange?: (value: string) => void;
}): { field: HTMLElement; node: HTMLSelectElement } {
  const node = el('select', { class: 'input', id: options.id });
  for (const choice of options.choices) {
    const option = el('option', { value: choice.value, text: choice.label });
    if (choice.value === options.value) option.selected = true;
    node.append(option);
  }
  if (options.onChange) {
    node.addEventListener('change', () => options.onChange?.(node.value));
  }
  const field = el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: options.id, text: options.label }),
    node,
    el('p', { class: 'field-error', id: `${options.id}-error`, hidden: true }),
  ]);
  return { field, node };
}
