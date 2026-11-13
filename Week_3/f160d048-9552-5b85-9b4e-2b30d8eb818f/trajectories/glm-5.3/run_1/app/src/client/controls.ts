// Reusable controls: star ratings, comboboxes and filter chips.
import { h, clear } from './dom.js';
import { announce } from './feedback.js';
import { MOTION, runMotion } from './motion.js';

export interface StarRatingOptions {
  label: string;
  name: string;
  value: number | null;
  onChange: (value: number) => void;
}

// A radiogroup of five star radios worked by arrow keys, Home and End.
export function starRating(options: StarRatingOptions): HTMLElement {
  const group = h('div', { role: 'radiogroup', 'aria-label': options.label, class: 'star-group' });
  group.dataset.name = options.name;
  const radios: HTMLInputElement[] = [];
  for (let value = 1; value <= 5; value += 1) {
    const radio = h('input', {
      type: 'radio',
      name: options.name,
      value: String(value),
      'aria-label': value === 1 ? '1 star' : `${value} stars`,
    }) as HTMLInputElement;
    radio.checked = options.value === value;
    radio.addEventListener('change', () => {
      choose(value);
    });
    radio.addEventListener('keydown', (event) => {
      const current = options.value ?? 1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = current >= 5 ? 1 : current + 1;
        choose(next);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        const next = current <= 1 ? 5 : current - 1;
        choose(next);
      } else if (event.key === 'Home') {
        event.preventDefault();
        choose(1);
      } else if (event.key === 'End') {
        event.preventDefault();
        choose(5);
      } else if (event.key === ' ') {
        event.preventDefault();
        choose(value);
      }
    });
    radios.push(radio);
    const star = h(
      'span',
      { 'aria-hidden': 'true', class: 'star', 'data-value': String(value) },
      value <= (options.value ?? 0) ? '★' : '☆',
    );
    const cell = h('label', { class: 'star-cell' }, radio, star);
    group.appendChild(cell);
  }
  group.dataset.value = String(options.value ?? '');
  function choose(value: number): void {
    options.onChange(value);
    radios.forEach((radio, index) => {
      radio.checked = index + 1 === value;
    });
    group.dataset.value = String(value);
    group.querySelectorAll<HTMLElement>('.star').forEach((star) => {
      const starValue = Number(star.dataset.value);
      star.textContent = starValue <= value ? '★' : '☆';
    });
    runMotion(group, MOTION.starFill);
    announce(`${options.label}: ${value} of 5`);
  }
  return group;
}

export interface ComboboxOptions {
  label: string;
  value: string;
  placeholder?: string;
  fetchOptions: (text: string) => Promise<{ id?: string; name: string }[]>;
  onSelect: (choice: { id?: string; name: string }) => void;
  onFreeText?: (text: string) => void;
}

// A combobox that filters as you type and announces the active option.
export function combobox(options: ComboboxOptions): { root: HTMLElement; input: HTMLInputElement; refresh: () => void } {
  const inputId = `cb-input-${Math.random().toString(36).slice(2, 9)}`;
  const listId = `${inputId}-list`;
  const input = h('input', {
    type: 'text',
    id: inputId,
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    'aria-controls': listId,
    autocomplete: 'off',
    value: options.value,
    placeholder: options.placeholder ?? '',
  }) as HTMLInputElement;
  const list = h('ul', { id: listId, role: 'listbox', 'aria-label': `${options.label} suggestions`, class: 'combobox-list' });
  const root = h('div', { class: 'combobox' }, h('label', { for: inputId }, options.label), input, list);
  let items: { id?: string; name: string }[] = [];
  let activeIndex = -1;
  let typedBefore = options.value;
  let debounce = 0;

  input.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(async () => {
      await refresh(input.value);
    }, 300);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (items.length === 0) return;
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      setActive();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length === 0) return;
      activeIndex = Math.max(activeIndex - 1, 0);
      setActive();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < items.length) {
        input.value = items[activeIndex].name;
        options.onSelect(items[activeIndex]);
        close();
      } else {
        options.onFreeText?.(input.value);
        close();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.value = typedBefore;
      close();
    }
  });

  async function refresh(text: string): Promise<void> {
    items = await options.fetchOptions(text);
    activeIndex = -1;
    clear(list);
    for (const [index, item] of items.entries()) {
      const option = h('li', { role: 'option', id: `${listId}-option-${index}` }, item.name);
      list.appendChild(option);
    }
    if (items.length > 0) {
      input.setAttribute('aria-expanded', 'true');
    } else {
      input.setAttribute('aria-expanded', 'false');
    }
  }

  function setActive(): void {
    Array.from(list.children).forEach((child, index) => {
      const option = child as HTMLElement;
      option.classList.toggle('active', index === activeIndex);
      if (index === activeIndex) {
        input.setAttribute('aria-activedescendant', option.id);
        announce(`${items[index].name}, ${index + 1} of ${items.length}`);
      }
    });
  }

  function close(): void {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    clear(list);
    items = [];
    activeIndex = -1;
    typedBefore = input.value;
  }

  input.addEventListener('blur', () => {
    window.setTimeout(close, 150);
  });

  return {
    root,
    input,
    refresh: () => {
      void refresh(input.value);
    },
  };
}

export interface ChipOptions {
  label: string;
  pressed: boolean;
  count?: number;
  onToggle: () => void;
  onRemove?: () => void;
}

export function chip(options: ChipOptions): HTMLButtonElement {
  const button = h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': options.pressed ? 'true' : 'false',
  }) as HTMLButtonElement;
  button.appendChild(document.createTextNode(options.label));
  if (options.count !== undefined) {
    button.appendChild(h('span', { class: 'count', 'aria-hidden': 'true' }, ` ${options.count}`));
  }
  button.addEventListener('click', () => {
    options.onToggle();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      options.onToggle();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && options.onRemove) {
      if (options.pressed) {
        event.preventDefault();
        options.onRemove();
      }
    }
  });
  return button;
}

export function chipGroup(label: string, chips: HTMLButtonElement[]): HTMLElement {
  const group = h('div', { role: 'group', 'aria-label': label, class: 'chip-group' });
  for (const item of chips) group.appendChild(item);
  return group;
}

export function moveFocusToNextChip(group: HTMLElement, current: HTMLElement, clearButton: HTMLElement): void {
  const chips = Array.from(group.querySelectorAll<HTMLElement>('button'));
  const index = chips.indexOf(current);
  if (index >= 0 && index < chips.length - 1) {
    chips[index + 1].focus();
  } else {
    clearButton.focus();
  }
}
