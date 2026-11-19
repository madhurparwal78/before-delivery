import { fixed } from '../../shared/copy.js';
import { el } from '../dom.js';

/** The Delete bullet dialog, which names how many bullets are inside. */
export function openDeleteDialog(
  text: string,
  inside: number,
  onDelete: () => void,
  returnFocus: HTMLElement
): void {
  const deleteButton = el('button', { type: 'button', class: 'pill pill-accent' }, ['Delete']);
  const cancelButton = el('button', { type: 'button', class: 'pill pill-outline' }, ['Cancel']);
  const dialog = el(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Delete bullet', class: 'dialog delete-dialog' },
    [
      el('p', {}, [fixed.deleteDialog(text, inside)]),
      el('div', { class: 'dialog-actions' }, [deleteButton, cancelButton])
    ]
  );
  const backdrop = el('div', { class: 'backdrop' }, [dialog]);
  document.body.append(backdrop);

  const close = (): void => {
    backdrop.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    returnFocus.focus();
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (!backdrop.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const next = document.activeElement === deleteButton ? cancelButton : deleteButton;
      next.focus();
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  cancelButton.addEventListener('click', close);
  deleteButton.addEventListener('click', () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    onDelete();
  });
  cancelButton.focus();
}
