import { h } from '../dom.ts';
import { openDialog } from './dialog.ts';
import { COUNTER, GENERIC_ERROR, MISSING_SIGNATURE_FIELDS, VALIDATION } from '../../shared/copy.ts';
import { ApiCallError } from '../api.ts';
import type { DocumentJson } from '../../shared/types.ts';

/** `Send for signing` lists the order, then `Send` sends. */
export const openSendDialog = (
  document_: DocumentJson,
  opener: HTMLElement,
  send: () => Promise<DocumentJson>,
  onSent: (sent: DocumentJson) => void,
  onPending: () => void,
): void => {
  openDialog(
    'Send for signing',
    (handle) => {
      const error = h('p', { class: 'field-error', role: 'alert' });
      const list = h(
        'ul',
        { class: 'send-list' },
        ...document_.recipients.map((recipient) =>
          h('li', {}, `${recipient.order}. ${recipient.name} (${recipient.email})`),
        ),
      );
      const confirm = h('button', { type: 'button', class: 'button seal' }, 'Send');
      const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');

      confirm.addEventListener('click', () => {
        error.textContent = '';
        confirm.disabled = true;
        confirm.setAttribute('aria-busy', 'true');
        onPending();
        void (async () => {
          try {
            const sent = await send();
            handle.close();
            onSent(sent);
          } catch (failure) {
            confirm.disabled = false;
            confirm.removeAttribute('aria-busy');
            if (
              failure instanceof ApiCallError &&
              failure.failure.error === 'missing_signature_fields'
            ) {
              const names = failure.failure.extra['recipients'];
              error.textContent = MISSING_SIGNATURE_FIELDS(
                Array.isArray(names) ? names.map((name) => String(name)) : [],
              );
              return;
            }
            error.textContent = GENERIC_ERROR;
          }
        })();
      });
      cancel.addEventListener('click', () => handle.close());
      handle.body.append(list, error, h('div', { class: 'dialog-actions' }, confirm, cancel));
    },
    opener,
  );
};

export interface ReasonDialogCopy {
  label: string;
  confirm: string;
  emptyError: string;
  fieldId: string;
}

export const VOID_DIALOG: ReasonDialogCopy = {
  label: 'Void document',
  confirm: 'Void',
  emptyError: VALIDATION.reasonVoidEmpty,
  fieldId: 'void-reason',
};

export const DECLINE_DIALOG: ReasonDialogCopy = {
  label: 'Decline to sign',
  confirm: 'Decline',
  emptyError: VALIDATION.reasonDeclineEmpty,
  fieldId: 'decline-reason',
};

/**
 * The Void and Decline dialogs: a reason of 1 to 500 characters with a live
 * counter, the published empty-reason error, and a full keyboard path.
 */
export const openReasonDialog = (
  copy: ReasonDialogCopy,
  opener: HTMLElement,
  submit: (reason: string) => Promise<void>,
  onPending: () => void,
): void => {
  openDialog(
    copy.label,
    (handle) => {
      const reason = h('textarea', { id: copy.fieldId, rows: '3' });
      const counter = h('p', { class: 'counter' }, COUNTER.reason(0));
      const error = h('p', { class: 'field-error' });
      const confirm = h('button', { type: 'button', class: 'button' }, copy.confirm);
      const cancel = h('button', { type: 'button', class: 'button quiet' }, 'Cancel');

      reason.addEventListener('input', () => {
        const points = [...reason.value];
        if (points.length > 500) reason.value = points.slice(0, 500).join('');
        counter.textContent = COUNTER.reason([...reason.value].length);
      });
      confirm.addEventListener('click', () => {
        if (reason.value.trim() === '') {
          error.textContent = copy.emptyError;
          reason.focus();
          return;
        }
        error.textContent = '';
        confirm.disabled = true;
        confirm.setAttribute('aria-busy', 'true');
        onPending();
        void (async () => {
          try {
            await submit(reason.value);
            handle.close();
          } catch {
            confirm.disabled = false;
            confirm.removeAttribute('aria-busy');
            error.textContent = GENERIC_ERROR;
          }
        })();
      });
      cancel.addEventListener('click', () => handle.close());
      handle.body.append(
        h('div', { class: 'field' }, h('label', { for: copy.fieldId }, 'Reason'), reason),
        counter,
        error,
        h('div', { class: 'dialog-actions' }, confirm, cancel),
      );
    },
    opener,
  );
};
