import { ApiRequest, errorText } from './api.js';
import { el, status } from './ui.js';
import type { App } from './main.js';
import { navigate } from './main.js';
import type { BoardRoom } from './types.js';

export async function renderBoard(app: App): Promise<void> {
  const boardStatus = status('');
  boardStatus.setAttribute('role', 'status');
  boardStatus.setAttribute('aria-label', 'Board status');
  boardStatus.id = 'board-status';
  const roomBoard = el('div', { class: 'board-columns', role: 'region', 'aria-label': 'Room board' });
  const staysList = el('ul', { 'aria-label': "Today's stays" });

  const load = async () => {
    const res = await ApiRequest.get('/api/housekeeping/board');
    if (res.status !== 200) return;
    const rooms = (res.data.rooms as BoardRoom[]).slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    roomBoard.replaceChildren();
    for (const room of rooms) {
      const group = el('div', { class: 'room-group', role: 'group', 'aria-label': `Room ${room.number}` });
      group.setAttribute('data-status', room.status);
      const mk = (label: string, value: string) => {
        const btn = el('button', { text: `${room.number} ${label}`, 'aria-label': `Room ${room.number} ${label}` }) as HTMLButtonElement;
        btn.setAttribute('aria-pressed', room.status === value ? 'true' : 'false');
        btn.addEventListener('click', async () => {
          boardStatus.textContent = 'Saving status…';
          const res2 = await ApiRequest.post(`/api/rooms/${room.roomId}/status`, { status: value });
          if (res2.status === 200) {
            boardStatus.textContent = `Room ${room.number} is now ${value.replace('_', ' ')}.`;
            await load();
          } else {
            boardStatus.textContent = errorText(res2.data) ?? 'Status failed.';
          }
        });
        return btn;
      };
      group.append(
        el('div', { class: 'room-head' },
          el('span', { class: 'serif', text: room.number }),
          el('span', { class: 'chip', 'data-status': room.status, text: room.status.replace('_', ' ') }),
          el('span', { text: room.arrival ? `${room.arrival} to ${room.departure}` : '' })),
        el('div', { class: 'room-actions' }, mk('clean', 'clean'), mk('dirty', 'dirty'))
      );
      roomBoard.append(group);
    }
    // today's stays
    const withStays = rooms.filter(r => r.arrival);
    staysList.replaceChildren(...withStays.map(r =>
      el('li', { text: `Room ${r.number}: ${r.arrival} to ${r.departure}` })));
  };
  await load();

  const signOutBtn = el('button', { text: 'Sign out' });
  signOutBtn.addEventListener('click', async () => {
    await ApiRequest.del('/api/session');
    app.user = null;
    navigate('/');
  });
  const nav = el('nav', { 'aria-label': 'Main' });
  for (const [label, path, roles] of [
    ['Desk', '/desk', ['owner', 'front_desk']],
    ['Board', '/board', ['owner', 'front_desk', 'housekeeper']]
  ] as Array<[string, string, string[]]>) {
    if (!app.user || !roles.includes(app.user.role)) continue;
    const a = el('a', { href: path, text: label });
    if (window.location.pathname === path) a.classList.add('current');
    a.addEventListener('click', ev => { ev.preventDefault(); navigate(path); });
    nav.append(a);
  }

  const content = el('div', {},
    el('h1', { text: 'Room board' }),
    boardStatus,
    roomBoard,
    el('h2', { text: "Today's stays" }),
    staysList);
  const shell = el('div', {},
    el('div', { class: 'topbar' }, el('span', { class: 'brand', text: 'Nightroll' }), nav,
      el('span', { class: 'spacer' }), el('span', { text: app.user?.name ?? '' }), signOutBtn),
    el('main', {}, content));
  app.root.replaceChildren(shell);
  app.refreshBoard = load;
}
