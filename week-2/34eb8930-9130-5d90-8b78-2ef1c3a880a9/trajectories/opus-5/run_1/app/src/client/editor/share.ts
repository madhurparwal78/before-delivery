import type { Role, ShareEntry } from '../../shared/types.js';
import { ApiError, api } from '../api.js';
import { clear, el, escapeCloses, trapFocus } from '../dom.js';
import { announce } from '../shell.js';
import type { EditorSession } from './session.js';

const roleLabel = (role?: Role): string => (role ? role.charAt(0).toUpperCase() + role.slice(1) : '');
const ROLE_OPTIONS: Role[] = ['editor', 'commenter', 'viewer'];

function endsLabel(entry: ShareEntry): string | null {
  if (entry.status === 'expired') return 'Ended';
  if (entry.endsAt) return `Until ${new Date(entry.endsAt).toLocaleString()}`;
  return null;
}

/** The Share proposal dialog. Only the Owner can change access. */
export function openShareDialog(session: EditorSession, opener: HTMLElement | null): void {
  const isOwner = session.role === 'owner';
  const list = el('ul', { class: 'share-list', 'aria-label': 'People with access' });
  const emailInput = el('input', { type: 'email', class: 'share-email', 'aria-label': 'Email' });
  const emailError = el('p', { class: 'field-error' });
  const accessSelect = el('select', { 'aria-label': 'Access' });
  for (const role of ROLE_OPTIONS) accessSelect.appendChild(el('option', { value: role, text: roleLabel(role) }));
  const endsToggle = el('input', { type: 'checkbox', id: 'share-ends-toggle' });
  const endsInput = el('input', { type: 'datetime-local', 'aria-label': 'Access ends', disabled: true });
  const endsError = el('p', { class: 'field-error' });
  const addButton = el('button', { type: 'button', class: 'primary', text: 'Add person' });
  const closeButton = el('button', { type: 'button', class: 'chrome-button', text: 'Close' });

  endsToggle.addEventListener('change', () => {
    endsInput.disabled = !endsToggle.checked;
  });

  const close = (): void => {
    backdrop.remove();
    opener?.focus();
  };

  const dialog = el('div', { class: 'dialog share-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share proposal' }, [
    el('h2', { text: 'Share proposal' }),
    isOwner
      ? el('div', { class: 'share-form' }, [
          el('div', { class: 'field' }, [el('label', { text: 'Email' }), emailInput, emailError]),
          el('div', { class: 'field' }, [el('label', { text: 'Access' }), accessSelect]),
          el('div', { class: 'field inline' }, [endsToggle, el('label', { for: 'share-ends-toggle', text: 'Set an end time' })]),
          el('div', { class: 'field' }, [el('label', { text: 'Access ends' }), endsInput, endsError]),
          addButton,
        ])
      : el('p', { class: 'share-note', text: 'Only the proposal owner can change access.' }),
    list,
    closeButton,
  ]);
  const backdrop = el('div', { class: 'backdrop' }, [dialog]);
  trapFocus(dialog);
  escapeCloses(dialog, close);
  closeButton.addEventListener('click', close);
  document.body.appendChild(backdrop);

  function focusAfterRemoval(index: number): void {
    const items = [...list.querySelectorAll<HTMLElement>('button[data-remove]')];
    const next = items[index] ?? items[items.length - 1];
    if (next) next.focus();
    else if (isOwner) emailInput.focus();
  }

  async function refresh(): Promise<void> {
    const result = await api.shares(session.documentId).catch(() => null);
    if (!result) return;
    clear(list);
    result.shares.forEach((entry, index) => {
      const name = entry.person.displayName;
      const row = el('li', { class: 'share-row' }, [
        el('span', { class: 'chip', style: `background:${session.personColour(entry.person.personId)}` }),
        el('span', { class: 'share-name', text: name }),
        el('span', { class: 'share-role', text: roleLabel(entry.person.role ?? entry.role) }),
      ]);
      if (isOwner && entry.email) row.appendChild(el('span', { class: 'share-email-text', text: entry.email }));
      const ends = endsLabel(entry);
      if (isOwner && ends) row.appendChild(el('span', { class: 'share-ends', text: ends }));
      if (isOwner && entry.shareId) {
        const shareId = entry.shareId;
        const select = el('select', { 'aria-label': `Access for ${name}` });
        for (const role of ROLE_OPTIONS) {
          select.appendChild(el('option', { value: role, text: roleLabel(role), selected: role === entry.role }));
        }
        select.value = entry.role ?? 'viewer';
        select.addEventListener('change', () => {
          const role = select.value as Role;
          void api
            .patchShare(session.documentId, shareId, { role })
            .then(() => {
              announce(`${name} is now ${roleLabel(role)}`);
              void refresh();
            })
            .catch(() => undefined);
        });
        const remove = el('button', {
          type: 'button',
          class: 'chrome-button danger',
          'aria-label': `Remove ${name}`,
          text: 'Remove',
          'data-remove': shareId,
        });
        remove.addEventListener('click', () => {
          void api
            .removeShare(session.documentId, shareId)
            .then(async () => {
              announce(`Removed ${name}`);
              await refresh();
              focusAfterRemoval(index - 1);
            })
            .catch(() => undefined);
        });
        row.appendChild(select);
        row.appendChild(remove);
      }
      list.appendChild(row);
    });
  }

  addButton.addEventListener('click', () => {
    emailError.textContent = '';
    endsError.textContent = '';
    addButton.disabled = true;
    addButton.textContent = 'Adding';
    const endsAt = endsToggle.checked && endsInput.value ? new Date(endsInput.value).toISOString() : null;
    void api
      .addShare(session.documentId, { email: emailInput.value, role: accessSelect.value, endsAt })
      .then(async (entry) => {
        announce(`Shared with ${entry.person.displayName} as ${roleLabel(entry.role)}`);
        emailInput.value = '';
        await refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 409) {
          emailError.textContent = 'This person already has access.';
          emailInput.focus();
        } else if (error instanceof ApiError && error.fields) {
          emailError.textContent = error.fields.email ?? '';
          endsError.textContent = error.fields.endsAt ?? '';
          (error.fields.email ? emailInput : endsInput).focus();
        }
      })
      .finally(() => {
        addButton.disabled = false;
        addButton.textContent = 'Add person';
      });
  });

  void refresh();
  if (isOwner) emailInput.focus();
  else closeButton.focus();
}
