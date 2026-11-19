// Sessions page: search, the sessions the person may see, friends' sessions,
// the avatar they wear, and the open-a-session dialog.
import { api, el, type Ctx } from './main';
import type { Me } from './main';

interface SessionSummary {
  id: string;
  roomName: string;
  hostName: string;
  visibility: string;
  capacity: number;
  count: number;
  status: string;
}

interface AssetSummary {
  id: string;
  kind: string;
  name: string;
  ownerName: string;
  currentVersion: number | null;
  rank: string | null;
}

interface FriendSummary {
  personId: string;
  displayName: string;
  presence: string;
  session: { id: string; roomName: string } | null;
}

export async function renderSessionsPage(ctx: Ctx): Promise<void> {
  const m = ctx.me as Me;
  const main = ctx.main;
  main.append(el('h1', {}, 'Sessions'));

  const search = el('input', { type: 'search', 'aria-label': 'Search sessions', class: 'search' }) as HTMLInputElement;
  const count = el('div', { role: 'status', 'aria-label': 'Session count', class: 'status-region' });
  const list = el('ul', { class: 'plain', role: 'list', 'aria-label': 'Sessions' });
  const friendsList = el('ul', { class: 'plain', role: 'list', 'aria-label': "Friends' sessions" });
  const result = el('div', { role: 'status', 'aria-label': 'Session result', class: 'status-region' });

  const panel = el('div', { class: 'panel' }, search, count, list, friendsList);
  main.append(panel);

  const loadList = async (): Promise<void> => {
    const q = search.value.trim();
    const res = await api<{ sessions: SessionSummary[]; total: number }>(`/api/sessions?q=${encodeURIComponent(q)}`);
    list.textContent = '';
    for (const s of res.sessions) {
      const item = el('li', { 'data-session-id': s.id }, `${s.roomName} hosted by ${s.hostName} (${s.count}/${s.capacity})`);
      const join = el('button', { class: 'primary' }, `Join ${s.roomName}`);
      join.addEventListener('click', async () => {
        result.textContent = 'Opening...';
        try {
          await api(`/api/sessions/${s.id}/join`, { method: 'POST' });
          location.href = `/sessions/${s.id}`;
        } catch (e) {
          result.textContent = (e as Error).message;
        }
      });
      item.append(' ', join);
      list.append(item);
    }
    count.textContent = `${res.total}`;
  };
  search.addEventListener('input', () => void loadList());
  await loadList();

  // Friends' sessions
  try {
    const friends = await api<{ friends: FriendSummary[] }>('/api/friends');
    const mine = friends.friends.filter((f) => f.presence === 'in-session' && f.session);
    for (const f of mine) {
      const item = el('li', { 'data-session-id': f.session!.id }, `${f.displayName} in ${f.session!.roomName}`);
      const join = el('button', { class: 'primary' }, `Join ${f.displayName}`);
      join.addEventListener('click', async () => {
        result.textContent = 'Opening...';
        try {
          await api(`/api/sessions/${f.session!.id}/join`, { method: 'POST' });
          location.href = `/sessions/${f.session!.id}`;
        } catch (e) {
          result.textContent = (e as Error).message;
        }
      });
      item.append(' ', join);
      friendsList.append(item);
    }
  } catch {
    // no friends data
  }

  // Wear avatar
  const wear = el('select', { 'aria-label': 'Wear avatar' }) as HTMLSelectElement;
  const wearPanel = el('div', { class: 'panel' }, el('h2', {}, 'Your avatar'), wear);
  const assets = await api<{ assets: AssetSummary[] }>('/api/assets?kind=avatar');
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = 'None';
  wear.append(emptyOption);
  for (const a of assets.assets) {
    const o = document.createElement('option');
    o.value = a.id;
    o.textContent = a.name;
    if (m.avatarId === a.id) o.selected = true;
    wear.append(o);
  }
  wear.addEventListener('change', async () => {
    if (!wear.value) return;
    await api('/api/me/avatar', { method: 'PUT', body: JSON.stringify({ avatarId: wear.value }) }).catch(() => {});
  });
  main.append(wearPanel);

  // Open a session dialog
  const openButton = el('button', { class: 'primary' }, 'Open a session');
  const dialog = el('dialog', { 'aria-label': 'Open a session' }) as HTMLDialogElement;
  const roomSelect = el('select', { 'aria-label': 'Room' }) as HTMLSelectElement;
  const visibility = el('select', { 'aria-label': 'Visibility' }) as HTMLSelectElement;
  const capacity = el('input', { type: 'number', 'aria-label': 'Capacity', min: '1', value: '10' }) as HTMLInputElement;
  const community = el('select', { 'aria-label': 'Community' }) as HTMLSelectElement;
  const submit = el('button', { class: 'primary' }, 'Open session');
  const cancel = el('button', {}, 'Cancel');
  for (const v of ['public', 'friends', 'community', 'invite']) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    visibility.append(o);
  }
  const rooms = await api<{ assets: AssetSummary[] }>('/api/assets?kind=room');
  for (const r of rooms.assets) {
    const o = document.createElement('option');
    o.value = r.id;
    o.textContent = r.name;
    roomSelect.append(o);
  }
  const communities = await api<{ communities: { id: string; name: string; role: string }[] }>('/api/communities');
  for (const c of communities.communities.filter((c2) => c2.role === 'owner' || c2.role === 'steward')) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    community.append(o);
  }
  const communityField = el('label', {}, 'Community', community);
  communityField.hidden = true;
  visibility.addEventListener('change', () => {
    communityField.hidden = visibility.value !== 'community';
  });
  dialog.append(
    el('h2', {}, 'Open a session'),
    el('label', {}, 'Room', roomSelect),
    el('label', {}, 'Visibility', visibility),
    el('label', {}, 'Capacity', capacity),
    communityField,
    submit, cancel, result
  );
  main.append(el('div', { class: 'panel' }, openButton));
  document.body.append(dialog);
  const alertRegion = el('div', { role: 'alert', class: 'status-region' });
  main.append(alertRegion);
  openButton.addEventListener('click', () => dialog.showModal());
  cancel.addEventListener('click', () => dialog.close());
  submit.addEventListener('click', async () => {
    result.textContent = 'Opening...';
    try {
      const res = await api<{ id: string }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          roomId: roomSelect.value,
          visibility: visibility.value,
          capacity: Number(capacity.value),
          communityId: visibility.value === 'community' ? community.value : null,
        }),
      });
      location.href = `/sessions/${res.id}`;
    } catch (e) {
      const message = (e as Error).message;
      result.textContent = message;
      if (message.includes('unavailable')) alertRegion.textContent = message;
    }
  });
}
