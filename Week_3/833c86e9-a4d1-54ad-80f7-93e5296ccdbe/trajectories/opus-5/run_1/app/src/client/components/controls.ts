import { el } from '../dom';
import { state } from '../state';
import { t } from '../i18n';

export interface SpinOptions {
  label: string;
  min: number;
  max: number;
  value: number;
  step?: number;
  focusKey?: string;
  onChange: (value: number) => void;
}

/** A spinbutton: arrows step, Home and End reach the ends, typing works. */
export function spinbutton(options: SpinOptions): HTMLInputElement {
  const input = el('input', {
    type: 'number',
    min: options.min,
    max: options.max,
    step: options.step ?? 1,
    value: options.value,
    'aria-label': options.label,
    'data-focus-key': options.focusKey ?? null,
    class: 'spin',
  });
  const commit = (value: number): void => {
    const clamped = Math.min(options.max, Math.max(options.min, value));
    input.value = String(clamped);
    options.onChange(clamped);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Home') {
      event.preventDefault();
      commit(options.min);
    } else if (event.key === 'End') {
      event.preventDefault();
      commit(options.max);
    }
  });
  input.addEventListener('change', () => {
    const value = Number(input.value);
    commit(Number.isFinite(value) ? value : options.value);
  });
  return input;
}

export interface Destination {
  code: string;
  name: string;
  zone: string;
  cx: number;
  cy: number;
  property_count: number;
}

export interface ComboboxOptions {
  label: string;
  value: string;
  focusKey?: string;
  load: (text: string) => Promise<Destination[]>;
  onPick: (destination: Destination) => void;
}

/** The destination combobox: a listbox popup driven by aria-activedescendant. */
export function destinationCombobox(options: ComboboxOptions): HTMLElement {
  const listId = `destination-list-${Math.random().toString(36).slice(2, 8)}`;
  const listbox = el('ul', { role: 'listbox', id: listId, class: 'listbox', hidden: true });
  const input = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': listId,
    'aria-autocomplete': 'list',
    'aria-label': options.label,
    'data-focus-key': options.focusKey ?? null,
    autocomplete: 'off',
    value: options.value,
    class: 'combobox',
  });
  let items: Destination[] = [];
  let active = -1;
  let timer = 0;

  const close = (): void => {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const paint = (): void => {
    listbox.replaceChildren(
      ...items.map((destination, index) =>
        el(
          'li',
          {
            role: 'option',
            id: `${listId}-${index}`,
            'aria-selected': index === active ? 'true' : 'false',
            class: index === active ? 'option active' : 'option',
          },
          [t('ui.destination_option', { name: destination.name, n: destination.property_count })],
        ),
      ),
    );
    listbox.hidden = items.length === 0;
    input.setAttribute('aria-expanded', items.length > 0 ? 'true' : 'false');
    if (active >= 0) input.setAttribute('aria-activedescendant', `${listId}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const search = async (): Promise<void> => {
    input.setAttribute('aria-busy', 'true');
    items = await options.load(input.value.trim());
    input.removeAttribute('aria-busy');
    active = -1;
    paint();
  };

  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void search(), state.settings.typeDebounceMs);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) {
        void search();
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + delta + items.length) % items.length;
      paint();
      return;
    }
    if (event.key === 'Enter') {
      if (active >= 0 && items[active]) {
        event.preventDefault();
        const picked = items[active];
        input.value = picked.name;
        close();
        options.onPick(picked);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!listbox.hidden) close();
      else input.value = '';
    }
  });

  listbox.addEventListener('mousedown', (event) => {
    const option = (event.target as HTMLElement).closest('[role="option"]');
    if (!option) return;
    event.preventDefault();
    const index = Array.from(listbox.children).indexOf(option);
    const picked = items[index];
    if (!picked) return;
    input.value = picked.name;
    close();
    options.onPick(picked);
  });

  return el('div', { class: 'combobox-wrap' }, [input, listbox]);
}

export function childAgeSelect(index: number, value: number, onChange: (value: number) => void): HTMLSelectElement {
  const select = el(
    'select',
    { 'aria-label': t('ui.age_of_child', { n: index }), 'data-focus-key': `age:${index}`, class: 'age' },
    Array.from({ length: 18 }, (_, age) => el('option', { value: age, selected: age === value }, [String(age)])),
  );
  select.addEventListener('change', () => onChange(Number(select.value)));
  return select;
}

