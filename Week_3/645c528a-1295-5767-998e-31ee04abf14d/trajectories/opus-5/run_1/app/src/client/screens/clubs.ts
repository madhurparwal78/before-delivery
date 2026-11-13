import { CLUB_COPY, num } from '../../shared/copy.js';
import { api } from '../api.js';
import { clear, el, labelledButton, statusRegion } from '../dom.js';
import { navigate, type Screen, type ScreenContext } from '../navigate.js';
import { setPendingNotice, takePendingNotice } from '../notices.js';
import { onServerEvent, refreshMe, state } from '../state.js';

interface ClubListEntry {
  id: string;
  name: string;
  joinPolicy: string;
  memberCount: number;
  weeklyScore: number;
}

interface ClubBody extends ClubListEntry {
  members: { playerId: string; displayName: string; role: string; weeklyWins: number }[];
  requests: { playerId: string; displayName: string }[];
  messages: { id: string; playerId: string; displayName: string; preset: string; createdAt: string }[];
}

export function clubsScreen(): Screen {
  const notice = statusRegion('Club notice', 'notice');
  const list = el('div', { className: 'club-list' });
  const nameInput = el('input', { className: 'text-input', attrs: { type: 'text', 'aria-label': 'Club name' } });
  let policy = 'open';
  const policyGroup = el('div', { className: 'policy-group', attrs: { role: 'radiogroup', 'aria-label': 'Join policy' } });
  for (const [label, value] of [
    ['Open', 'open'],
    ['Request to join', 'request'],
  ] as const) {
    const input = el('input', { attrs: { type: 'radio', name: 'join-policy', value } });
    if (value === 'open') input.checked = true;
    input.addEventListener('change', () => {
      policy = value;
    });
    policyGroup.append(el('label', { className: 'policy-option', children: [input, label] }));
  }

  const createButton = labelledButton('Create club', () => void create(), { className: 'button primary' });

  async function create(): Promise<void> {
    const result = await api<ClubBody>('POST', '/api/clubs', { name: nameInput.value.trim(), joinPolicy: policy });
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    await refreshMe();
    navigate(`/clubs/${result.data.id}`);
  }

  async function join(club: ClubListEntry): Promise<void> {
    const result = await api<{ status: string }>('POST', `/api/clubs/${club.id}/join`);
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    const text = result.data.status === 'requested' ? CLUB_COPY.requested(club.name) : CLUB_COPY.joined(club.name);
    notice.textContent = text;
    if (result.data.status === 'member') {
      setPendingNotice('club', text);
      navigate(`/clubs/${club.id}`);
    } else await load();
  }

  async function load(): Promise<void> {
    const result = await api<{ clubs: ClubListEntry[] }>('GET', '/api/clubs');
    if (!result.ok) return;
    clear(list);
    for (const club of result.data.clubs) {
      const joinButton = labelledButton(`Join ${club.name}`, () => void join(club), { className: 'button' });
      if (club.memberCount >= 50) joinButton.disabled = true;
      list.append(
        el('div', {
          className: 'club-row',
          children: [
            el('a', {
              className: 'link',
              text: club.name,
              attrs: { href: `/clubs/${club.id}` },
              on: {
                click: (event) => {
                  event.preventDefault();
                  navigate(`/clubs/${club.id}`);
                },
              },
            }),
            el('p', { text: `${num(club.memberCount)} / 50` }),
            el('p', { text: `Weekly score ${num(club.weeklyScore)}` }),
            el('p', { text: club.memberCount >= 50 ? CLUB_COPY.full : '' }),
            joinButton,
          ],
        }),
      );
    }
  }

  void load();

  return {
    element: el('div', {
      className: 'clubs',
      children: [
        el('h1', { className: 'screen-heading', text: 'Clubs', attrs: { tabindex: '-1' } }),
        el('div', {
          className: 'club-create',
          children: [el('label', { text: 'Club name' }), nameInput, policyGroup, createButton],
        }),
        notice,
        list,
      ],
    }),
  };
}

export function clubScreen(context: ScreenContext): Screen {
  const id = context.params.id ?? '';
  const notice = statusRegion('Club notice', 'notice');
  const weeklyScore = statusRegion('Weekly score', 'notice');
  const members = statusRegion('Members', 'notice');
  const roster = el('ul', { className: 'roster', attrs: { role: 'list', 'aria-label': 'Roster' } });
  const requests = el('div', { className: 'club-requests' });
  const presets = el('div', { className: 'presets', attrs: { role: 'group', 'aria-label': 'Preset messages' } });
  const messages = el('div', { className: 'club-messages', attrs: { role: 'log', 'aria-label': 'Club messages', 'aria-live': 'polite' } });
  const heading = el('h1', { className: 'screen-heading', text: 'Club', attrs: { tabindex: '-1' } });
  const leaveButton = labelledButton('Leave club', () => void leave(), { className: 'button quiet' });
  let body: ClubBody | null = null;

  for (const preset of CLUB_COPY.presets) {
    presets.append(labelledButton(preset, () => void send(preset), { className: 'button' }));
  }

  async function load(): Promise<void> {
    const result = await api<ClubBody>('GET', `/api/clubs/${id}`);
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    body = result.data;
    render();
  }

  async function send(preset: string): Promise<void> {
    const result = await api<{ messageId: string }>('POST', `/api/clubs/${id}/messages`, { preset });
    if (!result.ok) notice.textContent = result.failure.message;
    else await load();
  }

  async function leave(): Promise<void> {
    const result = await api('POST', `/api/clubs/${id}/leave`);
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    notice.textContent = CLUB_COPY.left(body?.name ?? '');
    await load();
  }

  async function changeRole(playerId: string, name: string, role: 'owner' | 'officer' | 'member'): Promise<void> {
    const result = await api<ClubBody>('PATCH', `/api/clubs/${id}/members/${playerId}`, { role });
    if (!result.ok) {
      notice.textContent = result.failure.message;
      return;
    }
    notice.textContent = CLUB_COPY.roleChanged(name, role);
    body = result.data;
    render();
  }

  async function decide(playerId: string, decision: 'approve' | 'reject'): Promise<void> {
    const result = await api<{ status: string }>('POST', `/api/clubs/${id}/requests/${playerId}`, { decision });
    if (!result.ok) notice.textContent = result.failure.message;
    await load();
  }

  function openRoleMenu(opener: HTMLElement, playerId: string, name: string): void {
    const menu = el('div', { className: 'role-menu', attrs: { role: 'menu', 'aria-label': `Change role for ${name}` } });
    const options: [string, 'owner' | 'officer' | 'member'][] = [
      ['Make owner', 'owner'],
      ['Make officer', 'officer'],
      ['Make member', 'member'],
    ];
    const items = options.map(([label, role]) => {
      const item = el('button', { className: 'menu-item', text: label, attrs: { type: 'button', role: 'menuitem', tabindex: '-1' } });
      item.addEventListener('click', () => {
        menu.remove();
        opener.focus();
        void changeRole(playerId, name, role);
      });
      menu.append(item);
      return item;
    });
    menu.addEventListener('keydown', (event) => {
      const index = items.findIndex((item) => item === document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = (index + (event.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        menu.remove();
        opener.focus();
      }
    });
    opener.after(menu);
    items[0]?.focus();
  }

  function render(): void {
    if (!body) return;
    const active = document.activeElement as HTMLElement | null;
    const keepFocus = active && roster.contains(active) ? active.getAttribute('aria-label') : null;
    heading.textContent = body.name;
    weeklyScore.textContent = `Weekly score ${num(body.weeklyScore)}`;
    members.textContent = `${num(body.memberCount)} / 50`;
    const myRole = body.members.find((member) => member.playerId === state.me?.id)?.role ?? null;
    clear(roster);
    for (const member of body.members) {
      const row = el('li', {
        className: 'roster-row',
        attrs: { role: 'listitem' },
        children: [el('span', { text: `${member.displayName} ${member.role}` })],
      });
      if (myRole === 'owner' && member.playerId !== state.me?.id) {
        const button = labelledButton(
          `Change role for ${member.displayName}`,
          () => openRoleMenu(button, member.playerId, member.displayName),
          { className: 'button quiet' },
        );
        row.append(button);
      }
      roster.append(row);
    }
    clear(requests);
    if (myRole === 'owner' || myRole === 'officer') {
      for (const request of body.requests) {
        requests.append(
          el('div', {
            className: 'request-row',
            children: [
              el('span', { text: request.displayName }),
              labelledButton(`Approve ${request.displayName}`, () => void decide(request.playerId, 'approve'), { className: 'button' }),
              labelledButton(`Reject ${request.displayName}`, () => void decide(request.playerId, 'reject'), { className: 'button quiet' }),
            ],
          }),
        );
      }
    }
    clear(messages);
    for (const message of body.messages) {
      messages.append(el('p', { className: 'log-line', text: `${message.displayName}: ${message.preset}` }));
    }
    leaveButton.hidden = myRole === null;
    presets.hidden = myRole === null;
    if (keepFocus) roster.querySelector<HTMLElement>(`[aria-label="${keepFocus}"]`)?.focus();
  }

  const carried = takePendingNotice('club');
  if (carried) notice.textContent = carried;
  const unsubscribe = onServerEvent('club', () => void load());
  void load();

  return {
    element: el('div', {
      className: 'club',
      children: [heading, weeklyScore, members, notice, roster, requests, presets, messages, leaveButton],
    }),
    topics: [`club:${id}`],
    destroy: unsubscribe,
  };
}
