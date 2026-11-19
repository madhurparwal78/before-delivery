import { ApiFailure, api } from '../api';
import { h, replace } from '../dom';
import { notice, showAlert } from '../regions';
import { actionButton, labelledInput, OWNER_REASON, VIEWER_REASON } from '../ui';
import type { ScreenCtx } from '../router';
import type { Role } from '../../shared/types';

interface MembersResponse {
  members: { user_id: string; name: string; email: string; role: Role }[];
  invites: { id: string; email: string; role: Role }[];
}

export async function renderMembers(ctx: ScreenCtx): Promise<HTMLElement> {
  const workspaceId = ctx.workspace?.id ?? '';
  const role = ctx.workspace?.role ?? 'viewer';
  const reason = role === 'viewer' ? VIEWER_REASON : role === 'editor' ? OWNER_REASON : null;
  const data = await api<MembersResponse>('GET', `/api/workspaces/${workspaceId}/members`);
  const invitesHolder = h(
    'ul',
    { class: 'row-list', role: 'list', 'aria-label': 'Pending invites' },
    ...data.invites.map((invite) =>
      h('li', { class: 'row-item' }, h('span', { class: 'row-title', text: invite.email }), h('span', { class: 'row-meta', text: invite.role })),
    ),
  );

  const email = labelledInput('Invitee email', 'text', { disabled: reason });
  const inviteRole = labelledInput('Role', 'select', { choices: ['editor', 'viewer'], value: 'viewer', disabled: reason });
  const send = actionButton(
    'Send invite',
    async () => {
      try {
        await api('POST', `/api/workspaces/${workspaceId}/invites`, {
          email: email.input.value,
          role: (inviteRole.input as HTMLSelectElement).value,
        });
        notice(`Invite sent to ${email.input.value}`);
        const fresh = await api<MembersResponse>('GET', `/api/workspaces/${workspaceId}/members`);
        replace(
          invitesHolder,
          ...fresh.invites.map((invite) =>
            h(
              'li',
              { class: 'row-item' },
              h('span', { class: 'row-title', text: invite.email }),
              h('span', { class: 'row-meta', text: invite.role }),
            ),
          ),
        );
        email.input.value = '';
      } catch (error) {
        if (error instanceof ApiFailure) {
          if (error.status === 503) showAlert('Email is unavailable. The invite was not sent.');
          else notice(error.message);
        }
      }
    },
    { variant: 'primary', reason },
  );

  return h(
    'section',
    { class: 'screen-section members-screen' },
    h('h1', { class: 'display', text: 'Members' }),
    h(
      'div',
      { class: 'members-layout' },
      h(
        'div',
        { class: 'members-main' },
        h(
          'table',
          { class: 'data-table', 'aria-label': 'Members' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col', text: 'Name' }),
              h('th', { scope: 'col', text: 'Email' }),
              h('th', { scope: 'col', text: 'Role' }),
            ),
          ),
          h(
            'tbody',
            {},
            ...data.members.map((member) =>
              h(
                'tr',
                {},
                h('td', { text: member.name }),
                h('td', { text: member.email }),
                h('td', { text: member.role }),
              ),
            ),
          ),
        ),
        h('h2', { class: 'display display-small', text: 'Pending invites' }),
        invitesHolder,
      ),
      h('div', { class: 'card card-light invite-form' }, email.wrapper, inviteRole.wrapper, send.element),
    ),
  );
}
