import { el } from './dom.js';
import * as api from './api.js';
import type { Member, Invite, ShareLink, CitationReport, Role, Label, LedgerEntry } from '../shared/types.js';
import { requestFocus, rerender } from './app-state.js';
import { formatDateTime } from './layout.js';
import { dialogFrame, fieldError, mentionState, updateMention, buildMentionList, mentionKeydown } from './dialogs.js';
import { isFailure, type ProjectHandle } from './actions.js';

const ROLES: Role[] = ['owner', 'editor', 'reviewer', 'viewer'];

/** People and sharing: members, invites and the share link. */
export function peopleDialog(h: ProjectHandle, close: () => void): HTMLElement {
  return dialogFrame({ title: 'People and sharing', wide: true, close }, (body) => {
    const isOwner = h.role === 'owner';
    const membersTable = el('table', { class: 'members', 'aria-label': 'Members' });
    membersTable.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Name'), el('th', {}, 'Handle'), el('th', {}, 'Role'),
      ...(isOwner ? [el('th', {}, 'Email'), el('th', {}, '')] : []),
    )));
    const tbody = el('tbody');
    for (const m of h.members) {
      const row = el('tr', {});
      const u = m.user;
      row.appendChild(el('td', {}, u.displayName));
      row.appendChild(el('td', { class: 'mono' }, u.handle));
      if (isOwner && 'email' in u) {
        const picker = el('select', {
          'aria-label': `Role for ${u.displayName}`,
          onchange: (e: Event) => void changeRole(h, u.id, (e.target as HTMLSelectElement).value as Role),
        });
        for (const r of ROLES) {
          const opt = el('option', { value: r }, r);
          if (r === m.role) (opt as HTMLOptionElement).selected = true;
          picker.appendChild(opt);
        }
        row.appendChild(el('td', { class: 'mono' }, (u as { email: string }).email));
        row.appendChild(el('td', {}, picker));
        row.appendChild(el('td', {}, el('button', {
          'aria-label': `Remove ${u.displayName}`,
          onclick: () => void removeMember(h, u.id, u.displayName),
        }, 'Remove')));
      } else {
        row.appendChild(el('td', {}, m.role));
      }
      tbody.appendChild(row);
    }
    membersTable.appendChild(tbody);
    body.appendChild(membersTable);

    if (isOwner) {
      const inviteForm = el('div', { class: 'field' });
      let inviteError: string | undefined;
      const emailInput = el('input', { type: 'email', id: 'invite-email', placeholder: 'Email' }) as HTMLInputElement;
      const roleSelect = el('select', { 'aria-label': 'Invite role' });
      for (const r of ['editor', 'reviewer', 'viewer'] as Role[]) {
        roleSelect.appendChild(el('option', { value: r }, r));
      }
      const sendBtn = el('button', {
        onclick: () => void sendInvite(),
      }, 'Send invite');
      inviteForm.appendChild(el('label', { for: 'invite-email' }, 'Email'));
      inviteForm.appendChild(emailInput);
      inviteForm.appendChild(roleSelect);
      inviteForm.appendChild(sendBtn);
      const inviteErr = el('div', { id: 'invite-error' });
      inviteForm.appendChild(inviteErr);
      body.appendChild(inviteForm);

      async function sendInvite(): Promise<void> {
        inviteError = undefined;
        const email = emailInput.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          inviteError = 'Enter a valid email address.';
          showInviteError();
          return;
        }
        h.message('Sending invitation…');
        rerender();
        try {
          const res = await api.postInvite(h.pid, email, roleSelect.value as Role);
          h.message(`Invitation sent to ${email}`);
          emailInput.value = '';
          const invites = await api.getInvites(h.pid);
          h.setInvites(invites.invites);
          rerender();
        } catch (e) {
          if (isFailure(e)) {
            if (e.shape.status === 503) h.message('Invitation not sent: email is unavailable. Try again shortly.');
            else if (e.shape.status === 429) {
              const minutes = Math.ceil((e.shape.retryAfterSeconds ?? 60) / 60);
              h.message(`Invitation not sent: this project has reached 10 invitations this hour. Try again in ${minutes === 1 ? '1 minute' : `${minutes} minutes`}.`);
            } else if (e.shape.status === 409 && e.shape.code === 'already_member') h.message(`${email} is already a member`);
            else if (e.shape.status === 409 && e.shape.code === 'invite_pending') h.message(`${email} already has a pending invitation`);
            else h.message('Something went wrong. Try again.');
          } else h.message('Something went wrong. Try again.');
          rerender();
        }
      }
      function showInviteError(): void {
        inviteErr.replaceChildren(fieldError(inviteError) ?? el('span'));
      }

      const invitesTable = el('table', { class: 'invites', 'aria-label': 'Invitations' });
      invitesTable.appendChild(el('thead', {}, el('tr', {},
        el('th', {}, 'Email'), el('th', {}, 'Status'), el('th', {}, ''))));
      const ibody = el('tbody');
      for (const inv of h.invites) {
        const row = el('tr', {});
        row.appendChild(el('td', {}, inv.email));
        row.appendChild(el('td', {}, inv.status));
        if (inv.status === 'pending') {
          row.appendChild(el('td', {}, el('button', {
            'aria-label': `Revoke invite to ${inv.email}`,
            onclick: async () => {
              await api.postRevokeInvite(h.pid, inv.id).catch(() => {});
              h.message(`Invitation to ${inv.email} revoked`);
              const invites = await api.getInvites(h.pid);
              h.invites = invites.invites;
              rerender();
            },
          }, 'Revoke')));
        } else {
          row.appendChild(el('td', {}, ''));
        }
        ibody.appendChild(row);
      }
      invitesTable.appendChild(ibody);
      body.appendChild(invitesTable);

      const shareSection = el('div', { class: 'field' });
      shareSection.appendChild(el('h3', {}, 'Share link'));
      const linkBox = el('input', {
        type: 'text', readonly: 'readonly', 'aria-label': 'Share link',
      }) as HTMLInputElement;
      const link = h.shareLink;
      if (link) {
        linkBox.value = link.url;
        shareSection.appendChild(linkBox);
        shareSection.appendChild(el('p', { class: 'meta' }, link.active
          ? `Expires on ${formatDateTime(link.expiresAt)}`
          : `Expired on ${formatDateTime(link.expiresAt)}`));
      }
      const linkBtns = el('div', { class: 'actions-row' });
      linkBtns.appendChild(el('button', {
        onclick: async () => {
          const res = await api.postShareLink(h.pid);
          h.shareLink = res.shareLink;
          h.message(h.shareLink && link ? 'Share link regenerated. The old link no longer works.' : 'Share link created');
          rerender();
        },
      }, link ? 'Regenerate share link' : 'Create share link'));
      if (link) {
        linkBtns.appendChild(el('button', {
          onclick: async () => {
            await api.deleteShareLink(h.pid).catch(() => {});
            h.shareLink = null;
            h.message('Share link revoked');
            rerender();
          },
        }, 'Revoke share link'));
      }
      shareSection.appendChild(linkBtns);
      body.appendChild(shareSection);
    }
  });
}

async function changeRole(h: ProjectHandle, uid: string, role: Role): Promise<void> {
  try {
    const res = await api.patchMember(h.pid, uid, role);
    const idx = h.members.findIndex((m) => m.user.id === uid);
    if (idx >= 0) h.members[idx] = res.member;
    h.message(`${res.member.user.displayName} is now ${role}`);
    rerender();
  } catch (e) {
    if (isFailure(e) && (e.shape.status === 409 || e.shape.status === 403)) {
      const members = await api.getMembers(h.pid);
      h.members = members.members;
      h.message('A project needs at least one owner');
      rerender();
    } else {
      h.message('Something went wrong. Try again.');
      rerender();
    }
  }
}

async function removeMember(h: ProjectHandle, uid: string, name: string): Promise<void> {
  try {
    await api.deleteMember(h.pid, uid);
    h.members = h.members.filter((m) => m.user.id !== uid);
    h.message(`${name} was removed`);
    rerender();
  } catch (e) {
    if (isFailure(e) && e.shape.status === 409) {
      const members = await api.getMembers(h.pid);
      h.members = members.members;
      h.message('A project needs at least one owner');
    } else {
      h.message('Something went wrong. Try again.');
    }
    rerender();
  }
}
