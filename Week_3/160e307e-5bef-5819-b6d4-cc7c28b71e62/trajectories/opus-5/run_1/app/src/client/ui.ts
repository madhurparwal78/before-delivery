import { el, trapFocus } from './dom.js';

export interface DialogHandle {
  dialog: HTMLDialogElement;
  close: () => void;
}

/** Dialogs keep Tab inside themselves and return focus to the control that opened them. */
export function openDialog(
  label: string,
  build: (handle: DialogHandle) => (Node | string)[],
  options: { escapes?: boolean } = {},
): DialogHandle {
  const dialog = el('dialog', { 'aria-label': label });
  const handle: DialogHandle = {
    dialog,
    close: () => {
      if (dialog.open) dialog.close();
      dialog.remove();
    },
  };
  dialog.append(...build(handle));
  document.body.append(dialog);
  trapFocus(dialog);
  dialog.addEventListener('cancel', (event) => {
    if (options.escapes === false) {
      event.preventDefault();
      return;
    }
    handle.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  return handle;
}

export function switchControl(label: string, checked: boolean, onChange: (next: boolean) => void): HTMLElement {
  const node = el('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    class: 'switch',
  }, [el('span', { class: 'switch__track' }), el('span', { text: label })]);
  node.addEventListener('click', () => {
    const next = node.getAttribute('aria-checked') !== 'true';
    node.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });
  return node;
}

export interface RadioOption {
  value: string;
  label: string;
}

export function radioGroup(
  label: string,
  options: RadioOption[],
  value: string,
  onChange: (next: string) => void,
): HTMLElement {
  const group = el('div', { role: 'radiogroup', 'aria-label': label, class: 'row' });
  const radios: HTMLInputElement[] = [];
  let current = value;

  const select = (next: string, focus: boolean): void => {
    current = next;
    radios.forEach((radio) => {
      radio.checked = radio.value === next;
      radio.tabIndex = radio.value === next ? 0 : -1;
      if (focus && radio.value === next) radio.focus();
    });
    onChange(next);
  };

  for (const option of options) {
    const input = el('input', {
      type: 'radio',
      name: `rg-${label.replace(/\W+/g, '-')}`,
      value: option.value,
      'aria-label': option.label,
      checked: option.value === value,
      tabindex: option.value === value ? '0' : '-1',
    });
    input.addEventListener('change', () => select(option.value, false));
    radios.push(input);
    group.append(el('label', { class: 'row', style: 'font-weight:700' }, [input, el('span', { text: option.label })]));
  }

  group.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const index = options.findIndex((option) => option.value === current);
    const next = options[(index + step + options.length) % options.length];
    select(next.value, true);
  });

  return group;
}
