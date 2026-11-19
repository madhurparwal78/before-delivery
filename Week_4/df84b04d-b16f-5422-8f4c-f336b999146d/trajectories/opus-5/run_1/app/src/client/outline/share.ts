import { alerts, announce as say } from '../../shared/copy.js';
import type { ShareRow, ShareStatus } from '../../shared/types.js';
import { api, failureOf } from '../api.js';
import { clear, el } from '../dom.js';
import { alertNow, announce } from '../regions.js';

const WORDS: Record<ShareStatus, string> = {
  pending_send: 'Sending',
  sent: 'Sent',
  not_sent: 'Not sent',
  accepted: 'Accepted',
  lapsed: 'Expired',
  revoked: 'Expired'
};

function focusable(dialog: HTMLElement): HTMLElement[] {
  return [
    ...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, a[href]')
  ].filter((node) => node.offsetParent !== null || node.tagName === 'INPUT');
}

/** The Share bullet dialog: invitations, their states and the ways to change them. */
export function openShareDialog(
  bulletId: string,
  bulletText: string,
  returnFocus: HTMLElement
): void {
  const list = el('ul', { role: 'list', class: 'invitation-list', 'aria-label': 'Invitations' });
  const emailInput = el('input', {
    type: 'email',
    id: 'collaborator-email',
    class: 'input',
    autocomplete: 'off'
  });
  const emailError = el('p', { class: 'field-error' });
  const sendButton = el('button', { type: 'button', class: 'pill pill-accent' }, ['Send invitation']);
  const closeButton = el('button', { type: 'button', class: 'icon-button close-button' }, ['✕']);
  closeButton.setAttribute('aria-label', 'Close');

  const dialog = el(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share bullet', class: 'dialog share-dialog' },
    [
      el('div', { class: 'dialog-head' }, [
        el('h2', {}, [`Share ${bulletText}`]),
        closeButton
      ]),
      el('p', { class: 'muted' }, ['They will see this branch and nothing else.']),
      list,
      el('div', { class: 'field' }, [
        el('label', { for: 'collaborator-email' }, ['Collaborator email']),
        emailInput,
        emailError
      ]),
      sendButton
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
      const items = focusable(dialog);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKeyDown, true);
  closeButton.addEventListener('click', close);

  const drawRows = (shares: ShareRow[]): void => {
    clear(list);
    for (const share of shares) {
      const row = el('li', { class: 'invitation-row' }, [
        el('span', { class: 'invitation-email' }, [share.email]),
        el('span', { class: 'invitation-status' }, [WORDS[share.status]])
      ]);
      if (share.status === 'not_sent') {
        const retry = el('button', { type: 'button', class: 'text-button' }, ['Retry']);
        retry.setAttribute('aria-label', `Retry invitation to ${share.email}`);
        retry.addEventListener('click', () => {
          void (async () => {
            try {
              const result = await api.retryInvite(share.id);
              if (result.share.status === 'sent') announce(say.invitationSent(share.email));
              else alertNow(alerts.invitationNotSent(share.email));
            } catch (error) {
              const failure = failureOf(error);
              if (failure?.message !== undefined) alertNow(failure.message);
            }
            await load();
          })();
        });
        row.append(retry);
      }
      const remove = el('button', { type: 'button', class: 'text-button' }, ['Remove access']);
      remove.setAttribute('aria-label', `Remove access for ${share.email}`);
      remove.addEventListener('click', () => {
        void (async () => {
          try {
            await api.removeShare(share.id);
            announce(say.accessRemoved(share.email));
          } catch (error) {
            const failure = failureOf(error);
            if (failure?.message !== undefined) alertNow(failure.message);
          }
          await load();
        })();
      });
      row.append(remove);
      list.append(row);
    }
  };

  async function load(): Promise<void> {
    const result = await api.shares(bulletId);
    drawRows(result.shares);
  }

  const send = async (): Promise<void> => {
    emailError.textContent = '';
    const address = emailInput.value.trim().toLowerCase();
    sendButton.disabled = true;
    sendButton.setAttribute('aria-busy', 'true');
    sendButton.textContent = 'Sending';
    const pendingRow = el('li', { class: 'invitation-row' }, [
      el('span', { class: 'invitation-email' }, [address]),
      el('span', { class: 'invitation-status' }, ['Sending'])
    ]);
    list.append(pendingRow);
    try {
      const result = await api.invite(bulletId, address);
      if (result.share.status === 'sent') announce(say.invitationSent(address));
      else alertNow(alerts.invitationNotSent(address));
      emailInput.value = '';
      await load();
    } catch (error) {
      const failure = failureOf(error);
      pendingRow.remove();
      if (failure?.errors?.['email'] !== undefined) emailError.textContent = failure.errors['email'];
      else if (failure?.message !== undefined) emailError.textContent = failure.message;
    } finally {
      sendButton.disabled = false;
      sendButton.removeAttribute('aria-busy');
      sendButton.textContent = 'Send invitation';
    }
  };

  sendButton.addEventListener('click', () => void send());
  emailInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void send();
    }
  });

  void load();
  emailInput.focus();
}
