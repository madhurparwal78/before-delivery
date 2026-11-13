import { el, focusables } from '../dom';

export interface DialogOptions {
  name: string;
  className?: string;
  /** Focus goes to the heading instead of the first control. */
  focusHeading?: boolean;
  onClose?: () => void;
}

export interface Dialog {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

let openDialogs = 0;

/** Every dialog keeps Tab inside itself, closes on Escape and returns focus to its opener. */
export function openDialog(options: DialogOptions, build: (dialog: Dialog) => Node[]): Dialog {
  const opener = document.activeElement as HTMLElement | null;
  const body = el('div', { class: 'dialog-body' });
  const root = el(
    'div',
    {
      class: `sheet${options.className ? ` ${options.className}` : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.name,
    },
    [body],
  );
  const dialog: Dialog = {
    root,
    body,
    close: () => {
      if (!root.isConnected) return;
      root.remove();
      openDialogs -= 1;
      document.removeEventListener('keydown', onKeyDown, true);
      if (options.onClose) options.onClose();
      if (opener && opener.isConnected) opener.focus();
    },
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!root.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const order = focusables(root);
    if (order.length === 0) return;
    const first = order[0];
    const last = order[order.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  body.append(...build(dialog));
  document.body.append(root);
  openDialogs += 1;
  document.addEventListener('keydown', onKeyDown, true);
  const heading = body.querySelector<HTMLElement>('[role="heading"], h1, h2, h3');
  if (options.focusHeading && heading) {
    heading.tabIndex = -1;
    heading.focus();
  } else {
    const order = focusables(root);
    if (order.length > 0) order[0].focus();
    else if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }
  return dialog;
}

export function dialogsOpen(): boolean {
  return openDialogs > 0;
}

export interface MenuItem {
  label: string;
  disabled?: boolean;
  run: () => void;
}

/**
 * A menu opened from a button: arrows wrap, Home and End jump, Enter or Space runs,
 * Escape or Tab closes with focus back on the button.
 */
export function openMenu(
  button: HTMLButtonElement,
  name: string,
  items: MenuItem[],
  afterRun: () => void,
): void {
  const existing = document.querySelector('.menu');
  if (existing) existing.remove();
  const nodes: HTMLElement[] = [];
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': name });

  const close = (focusButton: boolean): void => {
    menu.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    button.setAttribute('aria-expanded', 'false');
    if (focusButton) button.focus();
  };

  const move = (delta: number): void => {
    const index = nodes.findIndex((node) => node === document.activeElement);
    const next = (index + delta + nodes.length) % nodes.length;
    nodes[next].focus();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!menu.isConnected) return;
    switch (event.key) {
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        close(true);
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        nodes[0].focus();
        break;
      case 'End':
        event.preventDefault();
        nodes[nodes.length - 1].focus();
        break;
      default:
        break;
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!menu.contains(event.target as Node)) close(false);
  }

  for (const item of items) {
    const node = el('button', {
      type: 'button',
      role: 'menuitem',
      class: 'menu-item',
      text: item.label,
      'aria-disabled': item.disabled ? 'true' : null,
      onclick: () => {
        if (item.disabled) return;
        close(false);
        item.run();
        afterRun();
      },
    });
    nodes.push(node);
    menu.append(node);
  }

  button.setAttribute('aria-expanded', 'true');
  button.parentElement?.append(menu);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  nodes[0]?.focus();
}
