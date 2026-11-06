import { clearFieldErrors } from './feedback.ts';

const openers = new WeakMap<HTMLDialogElement, HTMLElement>();
const focusTargets = new WeakMap<HTMLDialogElement, () => HTMLElement | null>();

export function dialogByName(name: string): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>(`[data-dialog="${name}"]`);
}

function focusables(dialog: HTMLDialogElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

export function openDialog(name: string, opener: HTMLElement | null): HTMLDialogElement | null {
  const dialog = dialogByName(name);
  if (dialog === null) return null;
  if (opener !== null) openers.set(dialog, opener);
  clearFieldErrors(dialog);
  const alert = dialog.querySelector<HTMLElement>('[data-dialog-alert]');
  if (alert !== null) {
    alert.textContent = '';
    alert.hidden = true;
  }
  dialog.showModal();
  const first =
    dialog.querySelector<HTMLElement>('input, select, textarea') ?? focusables(dialog)[0] ?? null;
  first?.focus();
  return dialog;
}

export function closeDialog(dialog: HTMLDialogElement, moveFocus = true): void {
  dialog.close();
  if (!moveFocus) return;
  const target = focusTargets.get(dialog)?.() ?? openers.get(dialog) ?? null;
  target?.focus();
}

/** After success, focus moves to the published target instead of the opening button. */
export function setFocusAfterSuccess(name: string, target: () => HTMLElement | null): void {
  const dialog = dialogByName(name);
  if (dialog !== null) focusTargets.set(dialog, target);
}

export function closeDialogToOpener(dialog: HTMLDialogElement): void {
  dialog.close();
  openers.get(dialog)?.focus();
}

/** A refused dialog stays open with everything typed and focus on its error text. */
export function showDialogAlert(dialog: HTMLDialogElement, copy: string): void {
  const alert = dialog.querySelector<HTMLElement>('[data-dialog-alert]');
  if (alert === null) return;
  alert.textContent = copy;
  alert.hidden = false;
  alert.focus();
}

export function wireDialogs(): void {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('[data-dialog]')) {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const nodes = focusables(dialog);
      if (nodes.length === 0) return;
      const first = nodes[0] as HTMLElement;
      const last = nodes[nodes.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const cancel = target?.closest<HTMLElement>('[data-action="cancel-dialog"]');
    if (cancel === null || cancel === undefined) return;
    const dialog = cancel.closest('dialog');
    if (dialog !== null) closeDialog(dialog as HTMLDialogElement);
  });
}
