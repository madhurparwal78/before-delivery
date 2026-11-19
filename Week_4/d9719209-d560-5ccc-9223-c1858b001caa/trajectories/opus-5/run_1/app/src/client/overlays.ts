import { focusable, on, qs, qsa } from './dom.js';
import { dialogEnter } from './motion.js';

export interface MenuItem {
  label: string;
  run: () => void;
}

let openMenu: { element: HTMLElement; button: HTMLElement } | null = null;

export function closeMenu(returnFocus: boolean): void {
  if (!openMenu) return;
  const { element, button } = openMenu;
  openMenu = null;
  element.remove();
  button.setAttribute('aria-expanded', 'false');
  if (returnFocus) button.focus();
}

/** The menu button pattern: Enter, Space or Down opens with focus on the first item. */
export function openMenuFor(button: HTMLElement, items: MenuItem[]): void {
  closeMenu(false);
  const list = document.createElement('div');
  list.className = 'menu-list';
  list.setAttribute('role', 'menu');
  list.tabIndex = -1;

  const entries = items.map((item) => {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'menu-item';
    entry.setAttribute('role', 'menuitem');
    entry.tabIndex = -1;
    entry.textContent = item.label;
    on(entry, 'click', () => {
      closeMenu(false);
      item.run();
    });
    list.append(entry);
    return entry;
  });

  button.parentElement?.append(list);
  button.setAttribute('aria-expanded', 'true');
  openMenu = { element: list, button };
  dialogEnter(list);
  entries[0]?.focus();

  on(list, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (keyboard.key === 'ArrowDown') {
      keyboard.preventDefault();
      entries[(index + 1) % entries.length]?.focus();
    } else if (keyboard.key === 'ArrowUp') {
      keyboard.preventDefault();
      entries[(index - 1 + entries.length) % entries.length]?.focus();
    } else if (keyboard.key === 'Home') {
      keyboard.preventDefault();
      entries[0]?.focus();
    } else if (keyboard.key === 'End') {
      keyboard.preventDefault();
      entries[entries.length - 1]?.focus();
    } else if (keyboard.key === 'Escape') {
      keyboard.preventDefault();
      closeMenu(true);
    } else if (keyboard.key === 'Tab') {
      closeMenu(false);
    }
  });
}

export function initMenuButtons(resolve: (button: HTMLElement) => MenuItem[]): void {
  on(document, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-menu-button]');
    if (!button) {
      if (openMenu && !target?.closest('.menu-list')) closeMenu(false);
      return;
    }
    if (openMenu && openMenu.button === button) {
      closeMenu(true);
      return;
    }
    const items = resolve(button);
    if (items.length > 0) openMenuFor(button, items);
  });

  on(document, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const target = keyboard.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('[data-menu-button]');
    if (!button || keyboard.key !== 'ArrowDown') return;
    keyboard.preventDefault();
    const items = resolve(button);
    if (items.length > 0) openMenuFor(button, items);
  });
}

export interface DialogOptions {
  title: string;
  body: string;
  alert?: boolean;
  opener: HTMLElement | null;
  onClose?: () => void;
}

export interface OpenDialog {
  element: HTMLElement;
  close: () => void;
}

let activeDialog: OpenDialog | null = null;

/** Dialogs are modal, trap focus, and return focus to the control that opened them. */
export function openDialog(options: DialogOptions): OpenDialog {
  activeDialog?.close();
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';

  const element = document.createElement('div');
  element.className = 'dialog';
  element.setAttribute('role', options.alert === true ? 'alertdialog' : 'dialog');
  element.setAttribute('aria-modal', 'true');
  element.setAttribute('aria-label', options.title);
  element.innerHTML = `<h2 class="dialog-title">${options.title}</h2>${options.body}`;

  backdrop.append(element);
  document.body.append(backdrop);
  dialogEnter(element);

  const close = () => {
    if (activeDialog?.element !== element) return;
    activeDialog = null;
    backdrop.remove();
    options.onClose?.();
    options.opener?.focus();
  };

  activeDialog = { element, close };

  const first = focusable(element)[0];
  (first ?? element).focus();

  on(element, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.key === 'Escape') {
      keyboard.preventDefault();
      close();
      return;
    }
    if (keyboard.key !== 'Tab') return;
    const items = focusable(element);
    if (items.length === 0) return;
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (keyboard.shiftKey && document.activeElement === firstItem) {
      keyboard.preventDefault();
      lastItem.focus();
    } else if (!keyboard.shiftKey && document.activeElement === lastItem) {
      keyboard.preventDefault();
      firstItem.focus();
    }
  });

  on(backdrop, 'mousedown', (event) => {
    if (event.target === backdrop) close();
  });

  for (const button of qsa('[data-dialog-cancel]', element)) on(button, 'click', () => close());

  return { element, close };
}

export function radioGroup(name: string, label: string, options: Array<{ value: string; label: string }>): string {
  return `<fieldset class="field" role="radiogroup" aria-label="${label}">
    <legend>${label}</legend>
    ${options
      .map(
        (option, index) =>
          `<label class="radio"><input type="radio" name="${name}" value="${option.value}"${
            index === 0 ? '' : ''
          } /> ${option.label}</label>`,
      )
      .join('')}
  </fieldset>`;
}

export function selectedRadio(element: HTMLElement, name: string): string | null {
  const checked = qs<HTMLInputElement>(`input[name="${name}"]:checked`, element);
  return checked ? checked.value : null;
}
