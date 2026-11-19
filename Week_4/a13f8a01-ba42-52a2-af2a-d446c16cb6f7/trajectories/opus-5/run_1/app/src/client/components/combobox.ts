import { h } from '../dom';

export interface ComboOption {
  id: string;
  label: string;
}

export interface Combobox {
  root: HTMLElement;
  input: HTMLInputElement;
  refresh: () => void;
}

let comboCount = 0;

/** Typing filters the list, Down and Up move through it, and Enter chooses the highlighted option. */
export const combobox = (settings: {
  label: string;
  options: () => ComboOption[];
  onChoose: (option: ComboOption | null, text: string) => void;
}): Combobox => {
  comboCount += 1;
  const listId = `combo-list-${comboCount}`;
  const list = h('ul', { role: 'listbox', id: listId, class: 'combo-list' });
  const input = h('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': settings.label,
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    class: 'combo-input',
  });
  const root = h('div', { class: 'combo' }, [input, list]);

  let highlighted = 0;
  let shown: ComboOption[] = [];

  const paint = (): void => {
    const query = input.value.trim().toLowerCase();
    shown = settings.options().filter((option) => option.label.toLowerCase().includes(query));
    if (highlighted >= shown.length) highlighted = Math.max(0, shown.length - 1);
    while (list.firstChild) list.removeChild(list.firstChild);
    shown.forEach((option, index) => {
      list.appendChild(
        h('li', {
          role: 'option',
          id: `${listId}-${index}`,
          class: index === highlighted ? 'option current' : 'option',
          'aria-selected': index === highlighted ? 'true' : 'false',
          text: option.label,
          onclick: () => settings.onChoose(option, option.label),
        }),
      );
    });
    input.setAttribute('aria-expanded', shown.length > 0 ? 'true' : 'false');
    const active = shown[highlighted];
    if (active) input.setAttribute('aria-activedescendant', `${listId}-${highlighted}`);
    else input.removeAttribute('aria-activedescendant');
  };

  input.addEventListener('input', () => {
    highlighted = 0;
    paint();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlighted = Math.min(highlighted + 1, shown.length - 1);
      paint();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
      paint();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      settings.onChoose(shown[highlighted] ?? null, input.value.trim());
    }
  });

  paint();
  return { root, input, refresh: paint };
};
