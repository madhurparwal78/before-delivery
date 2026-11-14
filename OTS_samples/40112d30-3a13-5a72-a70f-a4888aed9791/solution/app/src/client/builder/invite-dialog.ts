import { ApiFailure, api } from '../lib/api.ts';
import { h } from '../lib/dom.ts';
import { dialogShell, openDialog } from '../lib/dialog.ts';
import { alertText, announce } from '../lib/live.ts';
import { fieldError, onEnter, textField } from './field.ts';
import type { Context } from './context.ts';

// Invite editor: one email address; the reply is the same sentence whether or not that email has an account.

export function openInvite({ store }: Context, opener: HTMLElement): void {
  const email = textField({ name: 'Email address', rev: () => store.rev });
  const send = h('button', { type: 'button' }, 'Send invitation');
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const dialog = dialogShell('Invite editor', email.element, h('div', { class: 'dialog-actions' }, send, cancel));
  const open = openDialog(dialog, opener, { first: email.input });
  send.addEventListener('click', () => {
    void (async () => {
      try {
        const reply = await api<{ message: string }>('POST', `/api/forms/${store.detail.id}/invitations`, { email: email.value().trim() });
        announce(reply.message);
        open.close();
      } catch (error) {
        if (!(error instanceof ApiFailure)) throw error;
        alertText(error.message);
        fieldError(email.element, email.input, error.items[0]?.message ?? null);
      }
    })();
  });
  cancel.addEventListener('click', () => open.close());
  onEnter(email.input, () => send.click());
}
