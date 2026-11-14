import { M63 } from '../../shared/messages.ts';
import { api, ApiFailure } from '../lib/api.ts';
import { dialogShell, openDialog } from '../lib/dialog.ts';
import { h } from '../lib/dom.ts';
import { alertText, announce } from '../lib/live.ts';

// `Delete response <reference>` opens a modal that asks once; the row leaves the table when the server has deleted it.

interface Deletion { formId: string; id: string; reference: string }

export function openDeleteDialog(deletion: Deletion, opener: HTMLElement, onDeleted: () => void): void {
  const confirm = h('button', { type: 'button' }, 'Delete');
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const body = h('div', {}, h('p', {}, `Response ${deletion.reference}`), h('div', { class: 'actions dialog-actions' }, confirm, cancel));
  const { dialog, close } = openDialog(dialogShell('Delete response', body), opener);
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => { void remove(deletion, dialog, close, onDeleted); });
}

async function remove(deletion: Deletion, dialog: HTMLElement, close: () => void, onDeleted: () => void): Promise<void> {
  dialog.querySelector('.error-text')?.remove();
  try {
    await api('DELETE', `/api/forms/${deletion.formId}/responses/${deletion.id}`);
  } catch (failure) {
    if (!(failure instanceof ApiFailure)) throw failure;
    dialog.querySelector('.actions')?.before(h('p', { class: 'error-text' }, failure.message));
    alertText(failure.message);
    return;
  }
  close();
  onDeleted();
  announce(M63);
}
