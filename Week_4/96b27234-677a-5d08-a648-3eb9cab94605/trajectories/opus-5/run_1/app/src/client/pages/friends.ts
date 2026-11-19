import { api } from '../api.js';
import { clear, el, keepFocusSafe } from '../dom.js';
import { heading, navigate } from '../shell.js';
import { button, field, statusRegion } from '../widgets.js';
import type { Friend } from '../types.js';
import type { Page, PageContext } from '../main.js';

interface InviteView {
  id: string;
  email: string;
  state: string;
  expiresAt: string;
}

export async function renderFriends(ctx: PageContext): Promise<Page> {
  heading(ctx.main, 'Friends');
  const friendList = el('ul', { 'aria-label': 'Friends', class: 'rows' });
  const inviteEmail = field("Friend's email", 'email');
  const sendInvite = button('Send invite', 'primary');
  const inviteResult = statusRegion('Invite result');
  const sentList = el('ul', { 'aria-label': 'Sent invites', class: 'rows' });
  ctx.main.append(
    el('section', { class: 'panel' }, [el('h2', { text: 'Your friends' }), friendList]),
    el('section', { class: 'panel' }, [
      el('h2', { text: 'Invite a friend' }),
      inviteEmail.wrap,
      sendInvite,
      inviteResult
    ]),
    el('section', { class: 'panel' }, [el('h2', { text: 'Sent invites' }), sentList])
  );

  const drawFriends = async (): Promise<void> => {
    const response = await api.get<{ friends: Friend[] }>('/api/friends');
    clear(friendList);
    for (const friend of response.data?.friends ?? []) {
      const item = el('li', {
        'data-person-id': friend.personId,
        'data-presence': friend.presence
      });
      item.append(el('span', { text: `${friend.displayName} \u2014 ${friend.presence}` }));
      if (friend.session !== null) {
        const join = button(`Join ${friend.displayName}`);
        join.addEventListener('click', () => {
          void api.post(`/api/sessions/${friend.session?.id ?? ''}/join`).then((result) => {
            if (result.ok) navigate(`/sessions/${friend.session?.id ?? ''}`);
          });
        });
        item.append(join);
      }
      const remove = button(`Remove friend ${friend.displayName}`, 'danger');
      remove.addEventListener('click', () => {
        void api.remove(`/api/friends/${friend.personId}`).then(() => {
          keepFocusSafe(item);
          void drawFriends();
        });
      });
      item.append(remove);
      friendList.append(item);
    }
  };

  const drawInvites = async (): Promise<void> => {
    const response = await api.get<{ invites: InviteView[] }>('/api/friends/invites');
    clear(sentList);
    for (const invite of response.data?.invites ?? []) {
      const item = el('li', { 'data-invite-id': invite.id, 'data-invite-state': invite.state }, [
        el('span', { text: `${invite.email} \u2014 ${invite.state}` })
      ]);
      if (invite.state === 'pending') {
        const revoke = button(`Revoke invite to ${invite.email}`, 'danger');
        revoke.addEventListener('click', () => {
          inviteResult.textContent = 'Saving...';
          void api.remove(`/api/friends/invites/${invite.id}`).then((result) => {
            inviteResult.textContent = result.ok ? 'Invite revoked.' : (result.error ?? '');
            keepFocusSafe(item);
            void drawInvites();
          });
        });
        item.append(revoke);
      }
      sentList.append(item);
    }
  };

  sendInvite.addEventListener('click', () => {
    inviteResult.textContent = 'Sending invite...';
    void api.post('/api/friends/invites', { email: inviteEmail.input.value }).then((response) => {
      inviteResult.textContent = response.ok ? 'Invite on its way.' : (response.error ?? '');
      void drawInvites();
    });
  });

  await drawFriends();
  await drawInvites();
  return {
    onPersonEvent: (event) => {
      if (event.type === 'friend-presence' || event.type === 'safety-changed') void drawFriends();
    }
  };
}
