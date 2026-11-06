import { ERROR_COPY } from '../../shared/copy';
import { element } from '../dom';

/** A labelled control with its inline error text and a Problems summary. */
export interface Field {
  readonly node: HTMLElement;
  readonly control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  readonly name: string;
  showError(message: string): void;
  clearError(): void;
}

let sequence = 0;

function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function wrap(
  label: string,
  name: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  extra?: HTMLElement,
): Field {
  const id = nextId('field');
  const errorId = `${id}-error`;
  control.id = id;
  const error = element('p', {
    className: 'field-error',
    attributes: { id: errorId },
  });
  const node = element('div', {
    className: 'field',
    children: [
      element('label', { text: label, attributes: { for: id } }),
      control,
      extra ?? null,
      error,
    ],
  });
  return {
    node,
    control,
    name,
    showError(message: string): void {
      error.textContent = message;
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', errorId);
    },
    clearError(): void {
      error.textContent = '';
      control.removeAttribute('aria-invalid');
      control.removeAttribute('aria-describedby');
    },
  };
}

export function textField(label: string, name: string, value = ''): Field {
  const control = element('input', {
    className: 'control text-input',
    attributes: { type: 'text', name },
  });
  control.value = value;
  return wrap(label, name, control);
}

export function monoField(label: string, name: string, value = ''): Field {
  const field = textField(label, name, value);
  field.control.classList.add('mono');
  return field;
}

export function longTextField(label: string, name: string, value = ''): Field {
  const control = element('textarea', {
    className: 'control text-input text-area',
    attributes: { name, rows: '4' },
  });
  control.value = value;
  return wrap(label, name, control);
}

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export function selectField(
  label: string,
  name: string,
  choices: readonly Choice[],
  value?: string,
): Field {
  const control = element('select', { className: 'control select-input', attributes: { name } });
  for (const choice of choices) {
    const option = element('option', { text: choice.label, attributes: { value: choice.value } });
    control.append(option);
  }
  if (value !== undefined) control.value = value;
  return wrap(label, name, control);
}

export interface RadioGroup {
  readonly node: HTMLElement;
  readonly name: string;
  value(): string;
  focusFirst(): void;
  showError(message: string): void;
  clearError(): void;
  readonly firstControl: HTMLInputElement;
}

export function radioGroup(
  label: string,
  name: string,
  choices: readonly Choice[],
  value: string,
): RadioGroup {
  const groupName = nextId(name);
  const inputs: HTMLInputElement[] = [];
  const options = choices.map((choice) => {
    const id = nextId('radio');
    const input = element('input', {
      attributes: { type: 'radio', name: groupName, value: choice.value, id },
    });
    if (choice.value === value) input.checked = true;
    inputs.push(input);
    return element('div', {
      className: 'radio-option',
      children: [
        input,
        element('label', { text: choice.label, attributes: { for: id }, className: 'radio-label' }),
      ],
    });
  });
  const error = element('p', { className: 'field-error' });
  const node = element('fieldset', {
    className: 'radio-group',
    attributes: { role: 'radiogroup', 'aria-label': label },
    children: [element('legend', { text: label }), ...options, error],
  });
  return {
    node,
    name,
    firstControl: inputs[0],
    value: () => inputs.find((input) => input.checked)?.value ?? value,
    focusFirst: () => (inputs.find((input) => input.checked) ?? inputs[0]).focus(),
    showError: (message: string) => {
      error.textContent = message;
    },
    clearError: () => {
      error.textContent = '';
    },
  };
}

export interface ProblemsSummary {
  readonly node: HTMLElement;
  show(fields: Readonly<Record<string, string>>, targets: readonly Field[]): void;
  showOne(message: string): void;
  clear(): void;
  focus(): void;
}

/** The Problems summary every form carries, in a page or in a dialog. */
export function problemsSummary(): ProblemsSummary {
  const list = element('ul', { className: 'problems-list' });
  const node = element('div', {
    className: 'problems',
    attributes: { role: 'region', 'aria-label': 'Problems', tabindex: '-1', hidden: 'hidden' },
    children: [element('h3', { text: 'Problems' }), list],
  });
  return {
    node,
    show(fields, targets): void {
      list.replaceChildren();
      for (const [name, message] of Object.entries(fields)) {
        const target = targets.find((field) => field.name === name);
        const anchor = element('a', {
          text: message,
          className: 'control link',
          attributes: { href: `#${target === undefined ? '' : target.control.id}` },
        });
        anchor.addEventListener('click', (event) => {
          event.preventDefault();
          target?.control.focus();
        });
        list.append(element('li', { children: [anchor] }));
        target?.showError(message);
      }
      node.removeAttribute('hidden');
    },
    showOne(message): void {
      const row = element('li', { text: message });
      // A session that ends mid-form offers its way back inside the panel.
      if (message === ERROR_COPY.session_ended || message === ERROR_COPY.access_removed) {
        row.append(
          element('a', {
            text: message === ERROR_COPY.session_ended ? 'Sign in again' : 'Sign in',
            className: 'control link again-link',
            attributes: { href: '/sign-in' },
          }),
        );
      }
      list.replaceChildren(row);
      node.removeAttribute('hidden');
    },
    clear(): void {
      list.replaceChildren();
      node.setAttribute('hidden', 'hidden');
    },
    focus(): void {
      node.focus();
    },
  };
}
