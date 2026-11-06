import { ApiFailure, api } from '../api';
import {
  COPY,
  accessRemoved,
  accessUpdated,
  invitationCreated,
  invitationDelivered,
  invitationExpired,
  invitationWithdrawn,
} from '../../shared/copy';
import { announce, el, field, openPanel, type Panel } from '../dom';
import type { ShareRow } from '../../shared/types';
import { isGateOpen, keepForSignIn } from './sessionGate';

interface RowRefs {
  row: HTMLTableRowElement;
  status: HTMLTableCellElement;
  controls: HTMLTableCellElement;
  roleSelect: HTMLSelectElement | null;
  actionButton: HTMLButtonElement | null;
  share: ShareRow;
}

function statusFor(share: ShareRow): string {
  if (share.status === 'active') return share.role === 'editor' ? 'Editor' : 'Viewer';
  if (share.status === 'expired') return 'Expired';
  return share.delivery === 'queued' ? 'Not yet delivered' : 'Invited';
}

/** The Share dialog: invite, change roles, remove and withdraw, by pointer or keyboard. */
export function openShareDialog(options: { diagramId: string; ownerEmail: string; ownerName: string }): Panel {
  const emailInput = el('input', { type: 'email', 'aria-label': 'Email' });
  const roleSelect = el('select', { 'aria-label': 'Role' }, [
    el('option', { value: 'editor', text: 'Editor' }),
    el('option', { value: 'viewer', text: 'Viewer' }),
  ]);
  const sendButton = el('button', { type: 'button', class: 'primary', text: 'Send invitation' });
  const emailError = el('div', { class: 'field-error', id: 'share-email-error' });
  const emailField = field('Email', emailInput, { id: 'share-email' });
  emailField.append(emailError);

  const tableBody = el('tbody');
  const table = el('table', { 'aria-label': 'People with access' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Person' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'Actions' }),
      ]),
    ]),
    tableBody,
  ]);

  const content = el('div', {}, [
    el('h2', { text: 'Share diagram' }),
    emailField,
    field('Role', roleSelect, { id: 'share-role' }),
    sendButton,
    table,
  ]);

  const panel = openPanel(content, { labelledBy: 'Share diagram', initialFocus: () => emailInput });
  const rows = new Map<string, RowRefs>();
  const seenState = new Map<string, string>();
  let loadedOnce = false;
  let confirmOpen = false;

  const ownerRow = el('tr');
  ownerRow.append(
    el('td', { text: options.ownerName ? `${options.ownerName} (${options.ownerEmail})` : options.ownerEmail }),
    el('td', { text: 'Owner' }),
    el('td', {}),
  );
  tableBody.append(ownerRow);

  function focusAfterRemoval(removed: RowRefs): void {
    const order = [...tableBody.querySelectorAll('tr')];
    const index = order.indexOf(removed.row);
    const next = order[index + 1];
    const previous = order[index - 1];
    const candidate = next ?? previous;
    const control = candidate?.querySelector<HTMLElement>('select, button');
    if (control) control.focus();
    else emailInput.focus();
  }

  function buildRow(share: ShareRow): RowRefs {
    const row = el('tr', { 'data-share': share.id });
    const person = el('td', { text: share.displayName ? `${share.displayName} (${share.email})` : share.email });
    const status = el('td', { text: statusFor(share) });
    const controls = el('td');
    row.append(person, status, controls);
    const refs: RowRefs = { row, status, controls, roleSelect: null, actionButton: null, share };
    fillControls(refs, share);
    return refs;
  }

  function fillControls(refs: RowRefs, share: ShareRow): void {
    refs.controls.replaceChildren();
    refs.roleSelect = null;
    refs.actionButton = null;
    if (share.status === 'active') {
      const select = el('select', { 'aria-label': `Role for ${share.email}` }, [
        el('option', { value: 'editor', text: 'Editor', selected: share.role === 'editor' }),
        el('option', { value: 'viewer', text: 'Viewer', selected: share.role === 'viewer' }),
      ]);
      select.addEventListener('change', () => {
        const role = select.value;
        void keepForSignIn(() =>
          api.patch<{ share: ShareRow }>(`/api/diagrams/${options.diagramId}/shares/${share.id}`, { role }),
        )
          .then((body) => {
            refs.share = body.share;
            refs.status.textContent = statusFor(body.share);
            seenState.set(body.share.id, statusFor(body.share));
            announce(accessUpdated(share.email));
            select.focus();
          })
          .catch(() => {
            announce(COPY.genericFailure);
          });
      });
      const remove = el('button', { type: 'button', text: 'Remove', 'aria-label': `Remove ${share.email}` });
      remove.addEventListener('click', () => openRemoveConfirm(refs));
      refs.controls.append(select, remove);
      refs.roleSelect = select;
      refs.actionButton = remove;
      return;
    }
    const withdraw = el('button', {
      type: 'button',
      text: 'Withdraw',
      'aria-label': `Withdraw invitation for ${share.email}`,
    });
    withdraw.addEventListener('click', () => {
      void keepForSignIn(() => api.del(`/api/diagrams/${options.diagramId}/shares/${share.id}`))
        .then(() => {
          announce(invitationWithdrawn(share.email));
          focusAfterRemoval(refs);
          refs.row.remove();
          rows.delete(share.id);
        })
        .catch(() => announce(COPY.genericFailure));
    });
    refs.controls.append(withdraw);
    refs.actionButton = withdraw;
  }

  function openRemoveConfirm(refs: RowRefs): void {
    confirmOpen = true;
    const removeButton = el('button', { type: 'button', class: 'primary', text: 'Remove access' });
    const cancelButton = el('button', { type: 'button', text: 'Cancel' });
    const confirmContent = el('div', {}, [
      el('h2', { text: 'Remove access' }),
      el('p', { text: `Remove ${refs.share.email} from this diagram?` }),
      el('div', { class: 'dialog-actions' }, [removeButton, cancelButton]),
    ]);
    const confirm = openPanel(confirmContent, {
      role: 'alertdialog',
      labelledBy: 'Remove access',
      initialFocus: () => cancelButton,
      onClose: () => {
        confirmOpen = false;
      },
    });
    cancelButton.addEventListener('click', () => confirm.close());
    removeButton.addEventListener('click', () => {
      removeButton.disabled = true;
      void keepForSignIn(() => api.del(`/api/diagrams/${options.diagramId}/shares/${refs.share.id}`))
        .then(() => {
          confirmOpen = false;
          confirm.close({ restoreFocus: false });
          announce(accessRemoved(refs.share.email));
          focusAfterRemoval(refs);
          refs.row.remove();
          rows.delete(refs.share.id);
        })
        .catch(() => {
          removeButton.disabled = false;
          announce(COPY.genericFailure);
        });
    });
  }

  function syncRows(shares: ShareRow[]): void {
    const keep = new Set<string>();
    for (const share of shares) {
      keep.add(share.id);
      const existing = rows.get(share.id);
      const text = statusFor(share);
      if (existing) {
        const previous = seenState.get(share.id);
        if (existing.status.textContent !== text) existing.status.textContent = text;
        const structureChanged = existing.share.status !== share.status;
        if (structureChanged) {
          const hadFocus = existing.controls.contains(document.activeElement);
          fillControls(existing, share);
          if (hadFocus) existing.controls.querySelector<HTMLElement>('select, button')?.focus();
        } else if (existing.roleSelect && existing.roleSelect !== document.activeElement) {
          existing.roleSelect.value = share.role;
        }
        existing.share = share;
        if (loadedOnce && previous !== undefined && previous !== text) {
          if (text === 'Invited' && previous === 'Not yet delivered') announce(invitationDelivered(share.email));
          else if (text === 'Expired') announce(invitationExpired(share.email));
        }
        seenState.set(share.id, text);
        continue;
      }
      const refs = buildRow(share);
      rows.set(share.id, refs);
      seenState.set(share.id, text);
      tableBody.append(refs.row);
    }
    for (const [id, refs] of [...rows]) {
      if (keep.has(id)) continue;
      const hadFocus = refs.row.contains(document.activeElement);
      refs.row.remove();
      rows.delete(id);
      seenState.delete(id);
      if (hadFocus) emailInput.focus();
    }
    loadedOnce = true;
  }

  async function refresh(): Promise<void> {
    const body = await api.get<{ shares: ShareRow[] }>(`/api/diagrams/${options.diagramId}/shares`);
    syncRows(body.shares);
  }

  sendButton.addEventListener('click', () => {
    const email = emailInput.value;
    const role = roleSelect.value;
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';
    emailError.textContent = '';
    emailInput.removeAttribute('aria-describedby');
    void keepForSignIn(() =>
      api.post<{ share: ShareRow }>(`/api/diagrams/${options.diagramId}/shares`, { email, role }),
    )
      .then((body) => {
        emailInput.value = '';
        syncRows([...[...rows.values()].map((refs) => refs.share), body.share]);
        announce(invitationCreated(body.share.email));
      })
      .catch((error: unknown) => {
        let message: string = COPY.genericFailure;
        if (error instanceof ApiFailure) {
          if (error.code === 'validation') message = COPY.inviteEmailInvalid;
          else if (error.code === 'already_member') message = COPY.inviteAlreadyMember;
          else if (error.code === 'invite_pending') message = COPY.invitePending;
          else if (error.code === 'invite_rate_limited') message = COPY.inviteRateLimited;
        }
        emailError.textContent = message;
        emailInput.setAttribute('aria-describedby', 'share-email-error');
      })
      .finally(() => {
        sendButton.disabled = false;
        sendButton.textContent = 'Send invitation';
      });
  });

  void refresh();
  const timer = window.setInterval(() => {
    if (isGateOpen() || confirmOpen) return;
    void refresh().catch(() => undefined);
  }, 10000);

  const originalClose = panel.close;
  panel.close = (): void => {
    window.clearInterval(timer);
    originalClose();
  };
  return panel;
}
