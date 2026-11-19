// Friends page: friends with presence, the invite form and sent invites.
import { api, el, type Ctx } from './main';

interface Friend {
  personId: string;
  displayName: string;
  presence: string;
  session: { id: string; roomName: string } | null;
}

interface Invite {
  id: string;
  email: string;
  state: string;
  expiresAt: string;
}

export async function renderFriendsPage(ctx: Ctx): Promise<void> {
  const main = ctx.main;
  main.append(el('h1', {}, 'Friends'));

  const list = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Friends' });
  const result = el('div', { role: 'status', 'aria-label': 'Invite result', class: 'status-region' });

  const friendsPanel = el('div', { class: 'panel' }, el('h2', {}, 'Your friends'), list);
  main.append(friendsPanel);

  const loadFriends = async (): Promise<Friend[]> => {
    const res = await api<{ friends: Friend[] }>('/api/friends');
    list.textContent = '';
    for (const f of res.friends) {
      const item = el('li', { 'data-person-id': f.personId, 'data-presence': f.presence }, `${f.displayName} (${f.presence})`);
      if (f.presence === 'in-session' && f.session) {
        const join = el('button', { class: 'primary' }, `Join ${f.displayName}`);
        join.addEventListener('click', async () => {
          try {
            await api(`/api/sessions/${f.session!.id}/join`, { method: 'POST' });
            location.href = `/sessions/${f.session!.id}`;
          } catch {
            await loadFriends();
          }
        });
        item.append(' ', join);
      }
      const remove = el('button', { class: 'danger', 'aria-label': `Remove friend ${f.displayName}` }, `Remove friend ${f.displayName}`);
      remove.addEventListener('click', async () => {
        await api(`/api/friends/${f.personId}`, { method: 'DELETE' }).catch(() => {});
        await loadFriends();
      });
      item.append(' ', remove);
      list.append(item);
    }
    return res.friends;
  };
  await loadFriends();

  // Invite form
  const email = el('input', { type: 'email', 'aria-label': "Friend's email" }) as HTMLInputElement;
  const send = el('button', { class: 'primary' }, 'Send invite');
  const inviteForm = el('div', { class: 'panel' }, el('h2', {}, 'Invite a friend'), email, send, result);
  main.append(inviteForm);

  const invitesList = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Sent invites' });
  const invitesPanel = el('div', { class: 'panel' }, el('h2', {}, 'Sent invites'), invitesList);
  main.append(invitesPanel);

  const loadInvites = async (): Promise<void> => {
    const res = await api<{ invites: Invite[] }>('/api/friends/invites');
    invitesList.textContent = '';
    for (const i of res.invites) {
      const item = el('li', {}, `${i.email} (${i.state})`);
      if (i.state === 'pending') {
        const revoke = el('button', { class: 'danger', 'aria-label': `Revoke invite to ${i.email}` }, `Revoke invite to ${i.email}`);
        revoke.addEventListener('click', async () => {
          await api(`/api/friends/invites/${i.id}`, { method: 'DELETE' }).catch(() => {});
          await loadInvites();
        });
        item.append(' ', revoke);
      }
      invitesList.append(item);
    }
  };
  await loadInvites();

  send.addEventListener('click', async () => {
    result.textContent = 'Sending invite...';
    try {
      await api('/api/friends/invites', { method: 'POST', body: JSON.stringify({ email: email.value }) });
      result.textContent = 'Invite on its way.';
      email.value = '';
      await loadInvites();
    } catch (e) {
      result.textContent = (e as Error).message;
    }
  });
}
