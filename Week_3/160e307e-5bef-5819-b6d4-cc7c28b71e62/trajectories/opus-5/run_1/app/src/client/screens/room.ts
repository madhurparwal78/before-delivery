import { api, ApiFailure } from '../api.js';
import type { MatchJson, RoomJson } from '../api.js';
import { clear, el, mmss } from '../dom.js';
import { icon } from '../icons.js';
import { navigate, onLeave, setPageStatus } from '../router.js';
import { Socket } from '../socket.js';
import { refreshMe } from '../store.js';
import { topbar } from './shell.js';

function closedPage(heading: string, line: string | null, view: HTMLElement): void {
  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: heading, style: 'font-size: var(--step-3)' }),
        ...(line === null ? [] : [el('p', { text: line })]),
        el('p', {}, [el('a', { href: '/', text: 'Home' })]),
      ]),
    ]),
  );
}

export async function renderRoom(params: Record<string, string>, view: HTMLElement): Promise<void> {
  const me = await refreshMe();
  const code = params.code.toUpperCase();
  let room: RoomJson;
  try {
    room = await api.get<RoomJson>(`/api/rooms/${code}`);
  } catch (failure) {
    const notFound = failure instanceof ApiFailure && failure.code === 'ROOM_NOT_FOUND';
    closedPage(notFound ? 'Room not found' : 'This room has closed', null, view);
    return;
  }
  if (room.status === 'closed') {
    closedPage('This room has closed', null, view);
    return;
  }

  const isHost = room.host?.id === me?.id;
  const isGuest = room.guest?.id === me?.id;
  if (!isHost && !isGuest) {
    closedPage('Room full', 'This room already has two players.', view);
    return;
  }

  const mySeat = isHost ? 0 : 1;
  const expiry = el('div', { id: 'room-expiry', class: 'num' });
  const toss = el('div', { id: 'toss-result', style: 'font-weight:700' });
  const seatNames = [el('span'), el('span')];
  const readyButtons = [
    el('button', { type: 'button', text: 'Ready', disabled: mySeat !== 0 }),
    el('button', { type: 'button', text: 'Ready', disabled: mySeat !== 1 }),
  ];
  const copyButton = el('button', { type: 'button' }, [icon('copy'), el('span', { text: 'Copy link' })]);
  copyButton.setAttribute('aria-label', 'Copy link');
  const link = `${window.location.origin}/join/${code}`;

  copyButton.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(link)
      .catch(() => undefined)
      .then(() => setPageStatus('Link copied'));
  });

  const socket = new Socket(() => `?room=${code}`);
  let expiresInMs = room.expiresInMs;
  let countdown: number | null = null;
  let navigating = false;

  function paintRoom(next: RoomJson): void {
    seatNames[0].textContent = next.host?.name ?? 'Waiting for opponent...';
    seatNames[1].textContent = next.guest?.name ?? 'Waiting for opponent...';
    expiresInMs = next.expiresInMs;
    paintExpiry();
  }

  function paintExpiry(): void {
    expiry.textContent = expiresInMs === null ? '' : `Closes in ${mmss(expiresInMs)}`;
  }

  countdown = window.setInterval(() => {
    if (expiresInMs === null) return;
    expiresInMs = Math.max(0, expiresInMs - 1000);
    paintExpiry();
  }, 1000);

  function paintMatch(match: MatchJson): void {
    readyButtons.forEach((button, index) => {
      if (match.seats[index].ready && index === mySeat) button.textContent = 'Waiting...';
    });
    if (match.status === 'active' && !navigating) {
      navigating = true;
      const white = match.seats[0].color === 'white' ? 0 : 1;
      toss.textContent = `${match.seats[white].name} won the toss and breaks with white.`;
      window.setTimeout(() => navigate(`/match/${match.id}`), 2000);
    }
  }

  readyButtons[mySeat].addEventListener('click', () => {
    readyButtons[mySeat].textContent = 'Waiting...';
    readyButtons[mySeat].disabled = true;
    void api
      .post<MatchJson>(`/api/matches/${room.matchId}/ready`)
      .then(paintMatch)
      .catch(() => undefined);
  });

  socket.on((message) => {
    if (message.type === 'roomStatus') {
      const next = message as unknown as RoomJson;
      paintRoom(next);
      if (next.matchId !== null) {
        void api
          .get<MatchJson>(`/api/matches/${next.matchId}`)
          .then(paintMatch)
          .catch(() => undefined);
      }
      return;
    }
    if (message.type === 'state') paintMatch(message as unknown as MatchJson);
  });
  socket.open();

  const cancel = el('button', { type: 'button', text: 'Cancel room' });
  cancel.addEventListener('click', () => {
    void api.del(`/api/rooms/${code}`).then(() => navigate('/')).catch(() => undefined);
  });

  onLeave(() => {
    socket.close();
    if (countdown !== null) window.clearInterval(countdown);
  });

  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: `Room ${code}`, style: 'font-size: var(--step-3)' }),
        el('div', { class: 'stack', style: 'margin-top:1.25rem' }, [
          el('div', { class: 'surface' }, [
            el('p', {}, [el('strong', { text: 'Code: ' }), el('span', { id: 'room-code', text: code })]),
            el('p', {}, [el('strong', { text: 'Link: ' }), el('span', { id: 'room-link', text: link })]),
            el('div', { class: 'row' }, [copyButton]),
            expiry,
          ]),
          el('div', { class: 'surface' }, [
            el('div', { class: 'row' }, [seatNames[0], readyButtons[0]]),
            el('div', { class: 'row' }, [seatNames[1], readyButtons[1]]),
            toss,
          ]),
          ...(isHost ? [el('div', { class: 'row' }, [cancel])] : []),
        ]),
      ]),
    ]),
  );
  paintRoom(room);
  if (room.matchId !== null) {
    void api
      .get<MatchJson>(`/api/matches/${room.matchId}`)
      .then(paintMatch)
      .catch(() => undefined);
  }
}
