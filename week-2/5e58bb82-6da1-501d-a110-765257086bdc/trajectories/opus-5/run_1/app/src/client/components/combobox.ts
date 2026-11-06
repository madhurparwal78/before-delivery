import { el, setText } from '../dom.js';

export interface ComboOption {
  value: string;
  label: string;
}

export interface Combobox {
  node: HTMLElement;
  trigger: HTMLElement;
  value(): string;
  setValue(value: string): void;
  onChange(listener: (value: string) => void): void;
}

let listboxCounter = 0;

/**
 * An ARIA combobox whose listbox is placed with fixed coordinates, so it always
 * lies wholly inside the viewport above every other layer and is never cut off by
 * a scrolling table — opening upwards when there is no room below.
 */
export function createCombobox(name: string, options: ComboOption[], initial: string): Combobox {
  listboxCounter += 1;
  const listboxId = `listbox-${listboxCounter}`;
  let current = initial;
  const listeners: ((value: string) => void)[] = [];

  const trigger = el('button', {
    type: 'button',
    role: 'combobox',
    'aria-label': name,
    'aria-expanded': 'false',
    'aria-haspopup': 'listbox',
    'aria-controls': listboxId,
    class: 'combo-trigger',
  });

  const listbox = el('ul', { role: 'listbox', id: listboxId, class: 'combo-listbox' });
  listbox.hidden = true;

  const items = options.map((option) => {
    const item = el('li', {
      role: 'option',
      id: `${listboxId}-${option.value || 'none'}`,
      'aria-selected': option.value === current ? 'true' : 'false',
      tabindex: '-1',
      class: 'combo-option',
    }, [option.label]);
    item.addEventListener('click', () => choose(option.value));
    listbox.append(item);
    return { option, item };
  });

  const node = el('div', { class: 'combo' }, [trigger, listbox]);

  function labelOf(value: string): string {
    return options.find((option) => option.value === value)?.label ?? '';
  }

  function paint(): void {
    setText(trigger, labelOf(current));
    for (const { option, item } of items) {
      item.setAttribute('aria-selected', option.value === current ? 'true' : 'false');
    }
  }

  function place(): void {
    const rect = trigger.getBoundingClientRect();
    listbox.hidden = false;
    listbox.style.position = 'fixed';
    listbox.style.zIndex = '500';
    listbox.style.minWidth = `${Math.max(rect.width, 160)}px`;
    const height = listbox.offsetHeight;
    const width = listbox.offsetWidth;
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    listbox.style.left = `${left}px`;
    const below = rect.bottom + 2;
    listbox.style.top =
      below + height > window.innerHeight ? `${Math.max(8, rect.top - height - 2)}px` : `${below}px`;
  }

  function open(): void {
    place();
    trigger.setAttribute('aria-expanded', 'true');
    const active = items.find(({ option }) => option.value === current) ?? items[0];
    active?.item.focus();
    if (active) listbox.setAttribute('aria-activedescendant', active.item.id);
  }

  function close(returnFocus: boolean): void {
    listbox.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    listbox.removeAttribute('aria-activedescendant');
    if (returnFocus) trigger.focus();
  }

  function choose(value: string): void {
    current = value;
    paint();
    close(true);
    for (const listener of listeners) listener(value);
  }

  function step(direction: number): void {
    const index = items.findIndex(({ item }) => item === document.activeElement);
    const next = items[Math.max(0, Math.min(items.length - 1, index + direction))];
    if (next) {
      next.item.focus();
      listbox.setAttribute('aria-activedescendant', next.item.id);
    }
  }

  trigger.addEventListener('click', () => {
    if (listbox.hidden) open();
    else close(true);
  });
  trigger.addEventListener('keydown', (event) => {
    if ((event.altKey && event.key === 'ArrowDown') || event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      open();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    }
  });
  listbox.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const active = items.find(({ item }) => item === document.activeElement);
        if (active) choose(active.option.value);
        break;
      }
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  });
  listbox.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!node.contains(document.activeElement)) close(false);
    }, 0);
  });

  paint();

  return {
    node,
    trigger,
    value: () => current,
    setValue: (value) => {
      current = value;
      paint();
    },
    onChange: (listener) => listeners.push(listener),
  };
}
