import { api } from '../api.js';
import { clear, el } from '../dom.js';
import { openDialog } from '../dialog.js';
import { heading, navigate } from '../shell.js';
import { button, field, select, statusRegion } from '../widgets.js';
import type { AssetSummary, CommunitySummary, SessionSummary } from '../types.js';
import type { PageContext } from '../main.js';

const VISIBILITIES = ['public', 'friends', 'community', 'invite'];

export async function renderSessions(ctx: PageContext): Promise<void> {
  heading(ctx.main, 'Sessions');
  const search = field('Search sessions', 'search');
  search.input.setAttribute('aria-label', 'Search sessions');
  const count = statusRegion('Session count');
  const sessionList = el('ul', { 'aria-label': 'Sessions', class: 'rows' });
  const friendList = el('ul', { 'aria-label': "Friends' sessions", class: 'rows' });
  const result = statusRegion('Session result');
  const openHolder = el('div', { class: 'row' });
  const avatarHolder = el('div', { class: 'row' });
  ctx.main.append(
    el('section', { class: 'panel' }, [search.wrap, count, sessionList, result]),
    el('section', { class: 'panel' }, [el('h2', { text: "Friends' sessions" }), friendList]),
    el('section', { class: 'panel' }, [el('h2', { text: 'Your avatar' }), avatarHolder]),
    el('section', { class: 'panel' }, [openHolder])
  );

  const rooms = await api.get<{ assets: AssetSummary[] }>('/api/assets?kind=room');
  const avatars = await api.get<{ assets: AssetSummary[] }>('/api/assets?kind=avatar');
  const communities = await api.get<{ communities: CommunitySummary[] }>('/api/communities');

  const wear = select(
    'Wear avatar',
    (avatars.data?.assets ?? []).map((asset) => ({ label: asset.name, value: asset.id })),
    ctx.me?.avatarId ?? null
  );
  wear.input.addEventListener('change', () => {
    void api.put('/api/me/avatar', { avatarId: wear.input.value });
  });
  avatarHolder.append(wear.wrap);

  const joinSession = (sessionId: string): void => {
    result.textContent = 'Opening...';
    void api.post(`/api/sessions/${sessionId}/join`).then((response) => {
      if (response.ok) {
        navigate(`/sessions/${sessionId}`);
        return;
      }
      result.textContent = response.error ?? '';
    });
  };

  const draw = (sessions: SessionSummary[]): void => {
    clear(sessionList);
    clear(friendList);
    count.textContent = `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}.`;
    for (const session of sessions) {
      const join = button(`Join ${session.roomName}`, 'primary');
      join.addEventListener('click', () => joinSession(session.id));
      sessionList.append(
        el('li', { 'data-session-id': session.id, 'data-visibility': session.visibility }, [
          el('span', { text: `${session.roomName} \u2014 ${session.hostName} \u2014 ${session.count} of ${session.capacity}` }),
          join
        ])
      );
      if (session.visibility !== 'friends') continue;
      const friendJoin = button(`Join ${session.hostName}`, 'primary');
      friendJoin.addEventListener('click', () => joinSession(session.id));
      friendList.append(
        el('li', { 'data-session-id': session.id }, [
          el('span', { text: `${session.roomName} \u2014 ${session.hostName}` }),
          friendJoin
        ])
      );
    }
  };

  const load = async (): Promise<void> => {
    const query = search.input.value.trim();
    const response = await api.get<{ sessions: SessionSummary[]; total: number }>(
      `/api/sessions${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`
    );
    draw(response.data?.sessions ?? []);
  };

  search.input.addEventListener('input', () => void load());

  const openButton = button('Open a session', 'primary');
  openButton.addEventListener('click', () => {
    openDialog(
      'Open a session',
      (close) => {
        const room = select(
          'Room',
          (rooms.data?.assets ?? []).map((asset) => ({ label: asset.name, value: asset.id }))
        );
        const visibility = select(
          'Visibility',
          VISIBILITIES.map((entry) => ({ label: entry, value: entry }))
        );
        const capacity = field('Capacity', 'number', { value: '10', min: '1' });
        const hosted = (communities.data?.communities ?? []).filter(
          (entry) => entry.role === 'owner' || entry.role === 'steward'
        );
        const community = select(
          'Community',
          hosted.map((entry) => ({ label: entry.name, value: entry.id }))
        );
        community.wrap.hidden = true;
        visibility.input.addEventListener('change', () => {
          community.wrap.hidden = visibility.input.value !== 'community';
        });
        const confirm = button('Open session', 'primary');
        const cancel = button('Cancel');
        confirm.addEventListener('click', () => {
          result.textContent = 'Opening...';
          void api
            .post<{ id: string }>('/api/sessions', {
              roomId: room.input.value,
              visibility: visibility.input.value,
              capacity: Number(capacity.input.value),
              communityId: visibility.input.value === 'community' ? community.input.value : null
            })
            .then((response) => {
              if (response.ok && response.data !== null) {
                close();
                navigate(`/sessions/${response.data.id}`);
                return;
              }
              result.textContent = response.error ?? '';
            });
        });
        cancel.addEventListener('click', () => close());
        return [
          el('h2', { text: 'Open a session' }),
          room.wrap,
          visibility.wrap,
          capacity.wrap,
          community.wrap,
          confirm,
          cancel
        ];
      },
      openButton
    );
  });
  openHolder.append(openButton);

  await load();
}
