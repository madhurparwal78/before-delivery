import { request } from './api';
import { el, focusElement } from './dom';
import { announce } from './shell';
import * as copy from './copy';

export type PasswordOutcome = 'confirmed' | 'closed';

/** The one password confirmation dialog, used by pack purchases and refunds. */
export function confirmPasswordDialog(returnFocusTo: HTMLElement | null): Promise<PasswordOutcome> {
  return new Promise<PasswordOutcome>((resolve) => {
    const dialog = el('dialog', { className: 'dialog', attrs: { 'aria-label': 'Confirm your password' } });
    const prompt = el('p', { text: copy.passwordDialog.prompt, className: 'dialog-prompt' });
    const fieldId = 'password-dialog-field';
    const errorId = 'password-dialog-error';
    const label = el('label', { text: 'Password', attrs: { for: fieldId }, className: 'field-label' });
    const field = el('input', {
      attrs: { id: fieldId, type: 'password', name: 'password', 'aria-label': 'Password' },
      className: 'field-input',
    });
    const error = el('p', { className: 'field-error', attrs: { id: errorId } });
    const pending = el('p', { className: 'pending-copy' });
    const confirmButton = el('button', { text: 'Confirm', attrs: { type: 'button' }, className: 'button' });
    const closeButton = el('button', { text: 'Close', attrs: { type: 'button' }, className: 'button quiet' });
    dialog.append(prompt, label, field, error, pending, confirmButton, closeButton);
    document.body.append(dialog);

    let settled = false;
    const finish = (outcome: PasswordOutcome): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      focusElement(returnFocusTo);
      resolve(outcome);
    };

    let busy = false;
    const submit = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      confirmButton.setAttribute('aria-disabled', 'true');
      closeButton.setAttribute('aria-disabled', 'true');
      pending.textContent = copy.passwordDialog.pending;
      const result = await request('POST', '/api/session/confirm', { body: { password: field.value } });
      busy = false;
      confirmButton.removeAttribute('aria-disabled');
      closeButton.removeAttribute('aria-disabled');
      pending.textContent = '';
      if (result.kind === 'stale') return;
      if (result.kind === 'ok') {
        finish('confirmed');
        return;
      }
      const message =
        result.kind === 'network'
          ? copy.generic
          : result.status === 429
            ? copy.passwordDialog.limit
            : copy.passwordDialog.wrong;
      field.value = '';
      error.textContent = message;
      field.setAttribute('aria-describedby', errorId);
      announce(message);
      focusElement(field);
    };

    confirmButton.addEventListener('click', () => {
      void submit();
    });
    closeButton.addEventListener('click', () => finish('closed'));
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish('closed');
    });

    dialog.showModal();
    focusElement(field);
  });
}
