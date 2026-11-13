import { el } from '../dom.js';
import { COPY, customCount } from '../copy.js';
import { collapseCustom, customCharacters, customWords } from './custom-text.js';

export interface CommandSpec {
  readonly label: string;
  apply(): void;
}

function focusable(dialog: HTMLElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
    ),
  ];
}

function trapTab(dialog: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const items = focusable(dialog);
  if (items.length === 0) return;
  const first = items[0] as HTMLElement;
  const last = items.at(-1) as HTMLElement;
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface OpenDialogs {
  readonly commandLine: boolean;
  readonly customText: boolean;
}

const open = { commandLine: false, customText: false };

export function dialogOpen(): boolean {
  return open.commandLine || open.customText;
}

export interface CommandLineOptions {
  readonly commands: readonly CommandSpec[];
  onApplied(command: CommandSpec): void;
  onEscape(): void;
}

export function openCommandLine(options: CommandLineOptions): void {
  const dialog = el('dialog', { class: 'dialog command-dialog', 'aria-label': 'Command line' });
  const input = el('input', {
    type: 'text',
    class: 'command-input',
    role: 'combobox',
    'aria-label': 'Command',
    'aria-expanded': 'true',
    'aria-controls': 'command-list',
    'aria-autocomplete': 'list',
    autocomplete: 'off',
  }) as HTMLInputElement;
  const list = el('div', {
    id: 'command-list',
    role: 'listbox',
    'aria-label': 'Commands',
    class: 'command-list',
  });
  dialog.append(input, list);
  document.body.append(dialog);
  open.commandLine = true;

  let matches: CommandSpec[] = [...options.commands];
  let activeIndex = 0;

  const optionId = (index: number): string => `command-option-${index}`;

  const paint = (): void => {
    list.textContent = '';
    matches.forEach((command, index) => {
      const item = el(
        'div',
        {
          role: 'option',
          id: optionId(index),
          class: 'command-option',
          'aria-selected': index === activeIndex ? 'true' : 'false',
        },
        [command.label],
      );
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        applyCommand(command);
      });
      item.addEventListener('click', () => applyCommand(command));
      list.append(item);
    });
    const active = matches[activeIndex];
    if (active) {
      input.setAttribute('aria-activedescendant', optionId(activeIndex));
      const node = list.children[activeIndex] as HTMLElement | undefined;
      node?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const close = (): void => {
    open.commandLine = false;
    dialog.close();
    dialog.remove();
  };

  const applyCommand = (command: CommandSpec): void => {
    close();
    command.apply();
    options.onApplied(command);
  };

  const filter = (): void => {
    const parts = input.value.toLowerCase().split(' ').filter((part) => part !== '');
    matches = options.commands.filter((command) => {
      const label = command.label.toLowerCase();
      return parts.every((part) => label.includes(part));
    });
    activeIndex = 0;
    paint();
  };

  input.addEventListener('input', filter);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      options.onEscape();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = matches[activeIndex];
      if (command) applyCommand(command);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + step + matches.length) % matches.length;
      paint();
      return;
    }
    trapTab(dialog, event);
  });

  paint();
  dialog.showModal();
  input.focus();
}

export interface CustomTextOptions {
  readonly initialText: string;
  onUse(text: string): void;
  onEscape(): void;
}

export function openCustomText(options: CustomTextOptions): void {
  const dialog = el('dialog', { class: 'dialog custom-dialog', 'aria-label': 'Custom text' });
  const field = el('textarea', {
    class: 'custom-field',
    'aria-label': 'Custom text',
    rows: 6,
  }) as HTMLTextAreaElement;
  field.value = options.initialText;
  const count = el('p', { id: 'custom-count', class: 'custom-count' });
  const use = el('button', { type: 'button', class: 'button' }, ['Use text']) as HTMLButtonElement;
  dialog.append(
    el('h2', { class: 'heading' }, ['Custom text']),
    field,
    count,
    el('div', { class: 'dialog-actions' }, [use]),
  );
  document.body.append(dialog);
  open.customText = true;

  const close = (): void => {
    open.customText = false;
    dialog.close();
    dialog.remove();
  };

  const update = (): void => {
    const text = collapseCustom(field.value);
    const characters = customCharacters(text);
    const words = customWords(text).length;
    const over = characters > 2000 || words > 400;
    count.textContent = over ? COPY.customLimit : customCount(characters, words);
    use.disabled = over;
  };

  const applyText = (): void => {
    if (use.disabled) return;
    const text = collapseCustom(field.value);
    close();
    options.onUse(text);
  };

  field.addEventListener('input', update);
  use.addEventListener('click', applyText);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      options.onEscape();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      applyText();
      return;
    }
    trapTab(dialog, event);
  });

  update();
  dialog.showModal();
  field.focus();
}
