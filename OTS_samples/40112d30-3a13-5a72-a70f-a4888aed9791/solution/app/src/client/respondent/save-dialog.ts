import { M68 } from '../../shared/messages.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { dialogShell, openDialog, type OpenDialog } from '../lib/dialog.ts';
import { h } from '../lib/dom.ts';
import { alertText, announce } from '../lib/live.ts';

interface SaveContext {
  readonly responseId: string;
  page(): string;
  /** Resolves once the server has every answer typed so far. */
  settle(): Promise<void>;
  refuse(error: unknown): void;
  onClose(): void;
}

/** `Save and finish later`: commits the page first, then mails the resume link and shows the server's own sentence. */
export function openSaveDialog(context: SaveContext, opener: HTMLElement): OpenDialog {
  const email = h('input', { id: 'save-email', type: 'email', autocomplete: 'email' });
  const status = h('p', { id: 'save-status', class: 'help' });
  const problem = h('p', { id: 'save-email-error', class: 'error-text', hidden: true });
  const send = h('button', { type: 'button', class: 'primary' }, 'Send link');
  const close = h('button', { type: 'button' }, 'Close');
  const dialog = dialogShell('Save and finish later',
    h('div', { class: 'field' }, h('label', { for: 'save-email' }, 'Email address'), email, problem),
    status,
    h('div', { class: 'dialog-actions' }, send, close));
  const opened = openDialog(dialog, opener, { onClose: context.onClose });

  function showProblem(message: string | null): void {
    problem.hidden = message === null;
    problem.textContent = message ?? '';
    if (message === null) {
      email.removeAttribute('aria-invalid');
      email.removeAttribute('aria-describedby');
    } else {
      email.setAttribute('aria-invalid', 'true');
      email.setAttribute('aria-describedby', problem.id);
    }
  }

  async function sendLink(): Promise<void> {
    if (send.getAttribute('aria-busy') === 'true') return;
    send.setAttribute('aria-busy', 'true');
    showProblem(null);
    try {
      await context.settle();
      const reply = await api<{ message: string }>('POST', `/api/responses/${context.responseId}/save`, { email: email.value, page: context.page() });
      status.textContent = reply.message;
      announce(reply.message);
    } catch (error) {
      const refused = error instanceof ApiFailure && error.code === 'VALIDATION_FAILED' ? error.items.find((item) => item.key === 'email') : undefined;
      if (refused) {
        showProblem(refused.message);
        alertText(M68);
      } else {
        opened.close();
        context.refuse(error);
      }
    } finally {
      send.removeAttribute('aria-busy');
    }
  }

  send.addEventListener('click', () => { void sendLink(); });
  email.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void sendLink();
  });
  close.addEventListener('click', () => opened.close());
  return opened;
}
