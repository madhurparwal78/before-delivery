import { h, clear } from './els.js';
import { announce } from './announce.js';

/**
 * Town combobox: typing filters by prefix, Arrow keys move the active option,
 * Enter selects, Escape restores the typed text.
 */
export interface ComboboxOpts {
  label: string;
  towns: string[];
  value: string | null;
  exclude?: string[];
  onSelect: (city: string) => void;
  placeholder?: string;
}

export function combobox(opts: ComboboxOpts): HTMLElement {
  const excluded = new Set(opts.exclude ?? []);
  let typed = opts.value ?? '';
  const listId = 'towns-' + Math.random().toString(36).slice(2, 8);
  const input = h('input', {
    class: 'field', type: 'text', role: 'combobox', 'aria-label': opts.label,
    'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list',
    autocomplete: 'off', placeholder: opts.placeholder ?? '',
  }) as HTMLInputElement;
  const list = h('ul', { id: listId, role: 'listbox', 'aria-label': 'Towns', class: 'listbox' });

  let filtered: string[] = [];
  let active = -1;

  const open = (): void => {
    input.setAttribute('aria-expanded', 'true');
    list.hidden = false;
  };
  const closeList = (): void => {
    input.setAttribute('aria-expanded', 'false');
    list.hidden = true;
  };

  const render = (): void => {
    clear(list);
    filtered.forEach((city, i) => {
      const opt = h('li', {
        role: 'option', 'aria-selected': i === active ? 'true' : 'false', id: `${listId}-${i}`,
        class: i === active ? 'option active' : 'option',
        onmousedown: (e: Event) => { e.preventDefault(); select(city); },
      }, city);
      list.append(opt);
    });
    if (active >= 0 && filtered[active]) {
      input.setAttribute('aria-activedescendant', `${listId}-${active}`);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const filter = (): void => {
    const q = typed.trim().toLowerCase();
    filtered = opts.towns.filter(t => !excluded.has(t) && t.toLowerCase().startsWith(q));
    active = filtered.length > 0 ? 0 : -1;
    render();
    if (filtered.length > 0) open(); else closeList();
  };

  const select = (city: string): void => {
    typed = city;
    input.value = city;
    closeList();
    opts.onSelect(city);
  };

  input.addEventListener('input', () => {
    typed = input.value;
    filter();
  });
  input.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'ArrowDown') {
      ke.preventDefault();
      if (filtered.length === 0) { filter(); return; }
      open();
      active = Math.min(active + 1, filtered.length - 1);
      render();
      announce(`${filtered[active]}, ${active + 1} of ${filtered.length}`);
    } else if (ke.key === 'ArrowUp') {
      ke.preventDefault();
      if (filtered.length === 0) return;
      active = Math.max(active - 1, 0);
      render();
      announce(`${filtered[active]}, ${active + 1} of ${filtered.length}`);
    } else if (ke.key === 'Enter') {
      ke.preventDefault();
      if (active >= 0 && filtered[active]) {
        select(filtered[active]);
      }
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      closeList();
      input.value = typed;
    }
  });
  input.addEventListener('focus', () => { filter(); });
  input.addEventListener('blur', () => { window.setTimeout(closeList, 120); });

  const wrap = h('div', { class: 'combobox-wrap' }, input, list);
  if (opts.value) input.value = opts.value;
  return wrap;
}
