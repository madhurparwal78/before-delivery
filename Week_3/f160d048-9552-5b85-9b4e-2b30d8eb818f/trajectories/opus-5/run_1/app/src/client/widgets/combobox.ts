import { announce } from '../core/announce';
import { el, on } from '../core/dom';

export const SEARCH_DEBOUNCE_MS = 300;

export interface ComboboxOption {
  id: string;
  label: string;
}

export interface Combobox {
  element: HTMLElement;
  input: HTMLInputElement;
  selected(): ComboboxOption | null;
  text(): string;
  setText(value: string): void;
}

interface ComboboxSettings {
  name: string;
  listName: string;
  load(query: string): Promise<ComboboxOption[]>;
  onSelect?(option: ComboboxOption): void;
  onSubmitText?(text: string): void;
}

/**
 * Typing filters the listbox after the search debounce; arrow keys move an
 * announced active option; Enter selects; Escape restores the typed text.
 */
export function combobox(settings: ComboboxSettings): Combobox {
  const id = `combo-${Math.random().toString(36).slice(2)}`;
  const input = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': settings.name,
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    'aria-controls': `${id}-list`,
    autocomplete: 'off',
    class: 'combobox-input',
  });
  const listbox = el('ul', {
    role: 'listbox',
    'aria-label': settings.listName,
    id: `${id}-list`,
    class: 'listbox',
    hidden: true,
  });
  const wrapper = el('div', { class: 'combobox' }, [input, listbox]);

  let options: ComboboxOption[] = [];
  let active = -1;
  let chosen: ComboboxOption | null = null;
  let typed = '';
  let timer = 0;

  const close = (): void => {
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  const paint = (): void => {
    for (const [index, item] of [...listbox.children].entries()) {
      const option = item as HTMLElement;
      option.setAttribute('aria-selected', index === active ? 'true' : 'false');
      option.classList.toggle('active', index === active);
    }
    const current = listbox.children[active] as HTMLElement | undefined;
    if (current) input.setAttribute('aria-activedescendant', current.id);
    else input.removeAttribute('aria-activedescendant');
  };

  const render = (): void => {
    listbox.replaceChildren();
    for (const [index, option] of options.entries()) {
      const item = el('li', {
        role: 'option',
        id: `${id}-option-${index}`,
        'aria-selected': 'false',
        class: 'option',
        text: option.label,
      });
      on(item, 'mousedown', (event) => {
        event.preventDefault();
        select(index);
      });
      listbox.append(item);
    }
    listbox.hidden = options.length === 0;
    input.setAttribute('aria-expanded', options.length > 0 ? 'true' : 'false');
    active = -1;
    paint();
  };

  const select = (index: number): void => {
    const option = options[index];
    if (!option) return;
    chosen = option;
    input.value = option.label;
    close();
    settings.onSelect?.(option);
  };

  const move = (step: number): void => {
    if (options.length === 0) return;
    const next = active + step;
    if (next < 0 || next >= options.length) return;
    active = next;
    paint();
    announce(`${options[active]?.label ?? ''}, ${active + 1} of ${options.length}`);
  };

  const load = (): void => {
    void settings.load(input.value).then((loaded) => {
      options = loaded;
      render();
    });
  };

  on(input, 'focus', () => {
    if (options.length === 0) load();
  });

  on(input, 'input', () => {
    typed = input.value;
    chosen = null;
    /** The old options stop being offered at once, so none is selected stale. */
    options = [];
    render();
    window.clearTimeout(timer);
    timer = window.setTimeout(load, SEARCH_DEBOUNCE_MS);
  });

  on(input, 'keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0) select(active);
      else {
        close();
        settings.onSubmitText?.(input.value);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.value = typed;
      close();
    }
  });

  return {
    element: wrapper,
    input,
    selected: () => chosen,
    text: () => input.value,
    setText: (value: string) => {
      input.value = value;
      typed = value;
    },
  };
}
