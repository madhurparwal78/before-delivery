import { announce } from '../announce.js';
import { h } from '../dom.js';

export interface ComboboxOptions {
  label: 'Leaving from' | 'Going to' | 'Add a stopover' | 'Vehicle' | 'Month';
  /** The towns still on offer; a town already used in the route is not offered. */
  choices: () => string[];
  value?: string;
  clearOnSelect?: boolean;
  onSelect: (choice: string) => void;
}

export interface ComboboxHandle {
  element: HTMLElement;
  input: HTMLInputElement;
  setValue(value: string): void;
  value(): string;
}

let counter = 0;

export function combobox(options: ComboboxOptions): ComboboxHandle {
  const id = `cb${(counter += 1)}`;
  const input = h('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': options.label,
    'aria-expanded': 'false',
    'aria-controls': `${id}-list`,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    class: 'field combobox-input',
  });
  input.value = options.value ?? '';
  const list = h('ul', {
    role: 'listbox',
    'aria-label': 'Towns',
    id: `${id}-list`,
    class: 'listbox',
    hidden: true,
  });
  const element = h('div', { class: 'combobox' }, input, list);

  let shown: string[] = [];
  let active = -1;
  let typed = input.value;

  const closeList = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const paint = () => {
    list.textContent = '';
    shown.forEach((choice, index) => {
      const option = h('li', {
        role: 'option',
        id: `${id}-opt${index}`,
        'aria-selected': index === active ? 'true' : 'false',
        class: index === active ? 'option active' : 'option',
        text: choice,
        onmousedown: (event: Event) => {
          event.preventDefault();
          select(index);
        },
      });
      list.appendChild(option);
    });
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-opt${active}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const openList = (filter: string) => {
    const needle = filter.trim().toLowerCase();
    shown = options
      .choices()
      .filter((choice) => choice.toLowerCase().startsWith(needle));
    if (shown.length === 0) {
      closeList();
      return;
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = 0;
    paint();
    announce(`${shown[0] as string}, 1 of ${shown.length}`);
  };

  const move = (delta: number) => {
    if (list.hidden) {
      openList(input.value);
      return;
    }
    const next = active + delta;
    if (next < 0 || next >= shown.length) return;
    active = next;
    paint();
    announce(`${shown[active] as string}, ${active + 1} of ${shown.length}`);
  };

  const select = (index: number) => {
    const choice = shown[index];
    if (!choice) return;
    closeList();
    if (options.clearOnSelect) {
      input.value = '';
      typed = '';
    } else {
      input.value = choice;
      typed = choice;
    }
    options.onSelect(choice);
  };

  input.addEventListener('input', () => {
    typed = input.value;
    openList(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (list.hidden) openList(input.value);
      else select(active);
      return;
    }
    if (event.key === 'Escape') {
      if (!list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        closeList();
        input.value = typed;
      }
    }
  });
  input.addEventListener('blur', () => window.setTimeout(closeList, 120));

  return {
    element,
    input,
    setValue(value: string) {
      input.value = value;
      typed = value;
    },
    value() {
      return input.value;
    },
  };
}
