import { h } from '../lib/dom.ts';

// Labelled form controls for the builder. A text box commits on blur, or on Enter in a single-line box, and
// remembers the revision the draft had when the person began typing, so a change that lands meanwhile is
// recognised as a conflict by the server rather than silently overwritten.

let counter = 0;
const uid = (prefix: string): string => `${prefix}-${counter += 1}`;

export interface TextField {
  element: HTMLElement;
  input: HTMLInputElement | HTMLTextAreaElement;
  /** Shows a value from the draft, unless the person has typed something that is not committed yet. */
  show: (value: string) => void;
  value: () => string;
  isDirty: () => boolean;
  clean: () => void;
}

interface TextOptions {
  name: string;
  multiline?: boolean;
  /** The draft revision now, read when typing begins. */
  rev: () => number;
  /** Blur, or Enter in a single-line box. Group boxes (rule, jump, formula, check) leave this out and save with their button. */
  onCommit?: (text: string, began: number) => void;
  onInput?: () => void;
}

export function textField(options: TextOptions): TextField {
  const id = uid('field');
  const input = options.multiline ? h('textarea', { id, rows: 3 }) : h('input', { id, type: 'text', autocomplete: 'off', spellcheck: 'false' });
  let dirty = false;
  let began = 0;
  const commit = (): void => {
    if (!dirty || !options.onCommit) return;
    dirty = false;
    options.onCommit(input.value, began);
  };
  input.addEventListener('input', () => {
    if (!dirty) began = options.rev();
    dirty = true;
    options.onInput?.();
  });
  input.addEventListener('blur', commit);
  if (!options.multiline) onEnter(input, commit);
  return {
    element: h('div', { class: 'field' }, h('label', { for: id }, options.name), input),
    input,
    show: (value) => { if (!dirty && input.value !== value) input.value = value; },
    value: () => input.value,
    isDirty: () => dirty,
    clean: () => { dirty = false; },
  };
}

/** Runs `action` when Enter is pressed in a single-line box. */
export function onEnter(target: HTMLElement, action: () => void): void {
  target.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    action();
  });
}

export interface SelectChoice { value: string; label: string }

export interface SelectField {
  element: HTMLElement;
  select: HTMLSelectElement;
  show: (value: string) => void;
  setChoices: (choices: readonly SelectChoice[]) => void;
}

export function selectField(name: string, choices: readonly SelectChoice[], onChange: (value: string) => void): SelectField {
  const id = uid('field');
  const select = h('select', { id });
  const setChoices = (next: readonly SelectChoice[]): void => {
    const current = select.value;
    select.replaceChildren(...next.map((choice) => h('option', { value: choice.value }, choice.label)));
    select.value = current;
    if (select.selectedIndex < 0) select.selectedIndex = 0;
  };
  setChoices(choices);
  select.addEventListener('change', () => onChange(select.value));
  return {
    element: h('div', { class: 'field' }, h('label', { for: id }, name), select),
    select,
    show: (value) => { if (select.value !== value) select.value = value; },
    setChoices,
  };
}

export interface CheckField {
  element: HTMLElement;
  input: HTMLInputElement;
  show: (checked: boolean) => void;
}

export function checkField(name: string, onChange: (checked: boolean) => void): CheckField {
  const input = h('input', { type: 'checkbox' });
  input.addEventListener('change', () => onChange(input.checked));
  return {
    element: h('label', { class: 'check' }, input, name),
    input,
    show: (checked) => { if (input.checked !== checked) input.checked = checked; },
  };
}

/** The message beside a field, in white words with the pink left-edge marker; `null` takes it away. */
export function fieldError(field: HTMLElement, control: HTMLElement, message: string | null): void {
  const known = field.querySelector('.error-text');
  if (message === null) {
    known?.remove();
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
    return;
  }
  const line = known ?? h('p', { id: uid('error'), class: 'error-text' });
  line.textContent = message;
  if (!known) field.append(line);
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', line.id);
}
