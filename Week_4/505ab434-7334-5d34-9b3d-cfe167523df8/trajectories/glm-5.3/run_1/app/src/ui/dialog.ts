import { el } from './types';

/** Traps focus inside a dialog: Tab from the last wraps to the first. */
export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const focusables = focusableIn(container);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

export interface SheetHandle {
  container: HTMLElement;
  close(): void;
}

/** Opens a bottom sheet dialog with the focus rules from the brief. */
export function openSheet(opts: {
  label: string;
  build(body: HTMLElement): void;
  opener: HTMLElement;
  onClosed?(): void;
}): SheetHandle {
  const backdrop = el('div', { class: 'dialog-backdrop' });
  const dialog = el('dialog', { class: 'sheet-dialog', 'aria-label': opts.label });
  const form = el('form');
  const body = el('div');
  form.append(body);
  const cancelButton = el('button', { type: 'button', class: 'ghost' }, 'Cancel');
  form.append(cancelButton);
  dialog.append(form);
  document.body.append(backdrop, dialog);

  const focusFirst = (): void => {
    const list = focusableIn(dialog).filter((n) => n !== cancelButton);
    (list[0] ?? cancelButton).focus();
  };

  const close = (): void => {
    dialog.close();
    dialog.remove();
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown, true);
    opts.opener.focus();
    opts.onClosed?.();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(dialog, event);
  };

  cancelButton.addEventListener('click', () => close());
  backdrop.addEventListener('click', () => close());
  document.addEventListener('keydown', onKeydown, true);

  opts.build(body);
  dialog.showModal();
  if (dialog.classList.contains('sheet-dialog') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    dialog.animate(
      [
        { transform: 'translateY(100%)' },
        { transform: 'translateY(0)' },
      ],
      { duration: 250, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
    );
  }
  setTimeout(focusFirst, 30);
  return { container: dialog, close };
}

/** Opens a plain centred dialog with the same focus rules. */
export function openDialog(opts: {
  label: string;
  build(body: HTMLElement): void;
  opener: HTMLElement;
  onClosed?(): void;
}): SheetHandle {
  const dialog = el('dialog', { class: 'plain-dialog', 'aria-label': opts.label });
  const body = el('div');
  const cancelButton = el('button', { type: 'button' }, 'Cancel');
  dialog.append(body, cancelButton);
  document.body.append(dialog);

  const close = (): void => {
    dialog.close();
    dialog.remove();
    document.removeEventListener('keydown', onKeydown, true);
    opts.opener.focus();
    opts.onClosed?.();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    trapFocus(dialog, event);
  };

  cancelButton.addEventListener('click', () => close());
  document.addEventListener('keydown', onKeydown, true);

  opts.build(body);
  dialog.showModal();
  const focusables = focusableIn(dialog);
  (focusables[0] ?? cancelButton).focus();
  return { container: dialog, close };
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isPhone(): boolean {
  return window.innerWidth < 768;
}
