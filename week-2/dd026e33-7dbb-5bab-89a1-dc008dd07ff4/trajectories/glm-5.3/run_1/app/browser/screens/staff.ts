/**
 * Staff access — the table of staff with revoke (confirmed in an alert dialog
 * that opens on Keep access) and restore.
 */
import { api, ApiFailure } from '../api.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import {
  ACCESS_REVOKED_FOR, ACCESS_RESTORED_FOR, SAVING, cannotChangeOwnAccessCopy, revokeConfirmText,
  staffAccessLabel,
} from '../../shared/copy.ts';
import { zurichDate } from '../../shared/dates.ts';
import type { Screen } from './screen.ts';

interface MemberData {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  revoked_at: string | null;
  last_sign_in_at: string | null;
}

export function renderStaff(main: HTMLElement): Screen {
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'access-updates' });
  const body = h('tbody');

  const rowFor = (member: MemberData): HTMLElement => {
    const button = member.active
      ? h('button', { text: `Revoke access for ${member.name}`, onclick: (event: Event) => confirmRevoke(event.currentTarget as HTMLElement, member) })
      : h('button', { text: `Restore access for ${member.name}`, onclick: () => void restore(member) });
    return h('tr', null,
      h('td', { text: member.name }),
      h('td', { text: member.email }),
      h('td', { text: member.role }),
      h('td', { text: member.last_sign_in_at ? zurichDate(member.last_sign_in_at) : '—' }),
      h('td', { 'data-cell': 'state', text: staffAccessLabel(member.active, member.revoked_at) }),
      h('td', null, button));
  };

  const patchRow = (row: HTMLElement, member: MemberData): void => {
    patchText(row.querySelector('[data-cell="state"]') as HTMLElement, staffAccessLabel(member.active, member.revoked_at));
  };

  const members = async (): Promise<MemberData[] | null> => {
    try {
      return ((await api.get('/api/staff')) as { staff: MemberData[] }).staff;
    } catch {
      return null;
    }
  };

  const confirmRevoke = (opener: HTMLElement, member: MemberData): void => {
    openDialog({
      name: `Revoke access for ${member.name}?`,
      opener,
      focusKeepButton: true,
      build: (dialog, close) => {
        const revoke = h('button', {
          class: 'primary',
          text: 'Revoke access',
          onclick: async () => {
            announce(region, SAVING);
            try {
              await api.patch(`/api/staff/${member.id}`, { active: false });
              announce(region, ACCESS_REVOKED_FOR(member.name));
              close('submit');
              const fresh = await members();
              if (fresh) reconcile(body, fresh, (candidate) => candidate.id, rowFor, patchRow);
              // focus moves to this row's new Restore button
              const row = body.querySelector(`tr:has(button)`);
              void row;
              const restoreButton = Array.from(body.querySelectorAll('button'))
                .find((button) => button.textContent === `Restore access for ${member.name}`);
              restoreButton?.focus();
            } catch (err) {
              if (err instanceof ApiFailure) {
                if (err.detail.code === 'cannot_change_own_access') {
                  announce(region, cannotChangeOwnAccessCopy());
                } else {
                  announce(region, err.detail.code ?? 'Saving failed.');
                }
                close('cancel');
              }
            }
          },
        });
        dialog.append(
          h('h2', { text: `Revoke access for ${member.name}?` }),
          h('p', { text: revokeConfirmText(member.name) }),
          h('div', { class: 'actions' },
            revoke,
            h('button', { 'data-keep': '', text: 'Keep access', onclick: () => close('cancel') })),
        );
      },
    });
  };

  const restore = async (member: MemberData): Promise<void> => {
    announce(region, SAVING);
    try {
      await api.patch(`/api/staff/${member.id}`, { active: true });
      announce(region, ACCESS_RESTORED_FOR(member.name));
      const fresh = await members();
      if (fresh) reconcile(body, fresh, (candidate) => candidate.id, rowFor, patchRow);
      const revokeButton = Array.from(body.querySelectorAll('button'))
        .find((button) => button.textContent === `Revoke access for ${member.name}`);
      revokeButton?.focus();
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.detail.code === 'cannot_change_own_access') {
          announce(region, cannotChangeOwnAccessCopy());
        } else {
          announce(region, err.detail.code ?? 'Saving failed.');
        }
      }
    }
  };

  const render = async (): Promise<void> => {
    main.replaceChildren(
      h('h1', { text: 'Staff access' }),
      region,
      h('table', { class: 'sheet', 'aria-label': 'Staff access' },
        h('thead', null, h('tr', null,
          h('th', { text: 'Name' }), h('th', { text: 'Email' }), h('th', { text: 'Role' }),
          h('th', { text: 'Last sign-in' }), h('th', { text: 'Access' }), h('th', { text: '' }))),
        body));
    const fresh = await members();
    if (!fresh) return;
    reconcile(body, fresh, (member) => member.id, rowFor, patchRow);
  };

  return {
    render,
    destroy() {
      // no periodic re-read
    },
  };
}
