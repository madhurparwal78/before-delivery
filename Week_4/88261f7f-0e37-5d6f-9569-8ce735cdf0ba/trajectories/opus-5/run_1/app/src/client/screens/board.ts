import { state } from '../app';
import { button, el } from '../dom';
import { changeRoomStatus } from '../dialogs/roomStatus';
import { regionNames, statusRegion } from '../regions';
import { RoomStatus, roomStatusWords } from '../../shared/roomStatus';
import { flashOnStatusChange } from '../statusFlash';
import { shell } from './shell';

const HOUSEKEEPER_MOVES: RoomStatus[] = ['clean', 'dirty'];
const DESK_MOVES: RoomStatus[] = ['clean', 'dirty', 'inspected', 'out_of_order'];

export function boardScreen(): HTMLElement {
  const board = state.board;
  const role = state.user ? state.user.role : 'housekeeper';
  const moves = role === 'housekeeper' ? HOUSEKEEPER_MOVES : DESK_MOVES;

  const groups = (board ? board.rooms : []).map((room) => {
    const chip = el('span', {
      class: `chip chip-${room.status}`,
      text: roomStatusWords(room.status as RoomStatus),
    });
    flashOnStatusChange(room.roomId, room.status, chip);
    return el('div', { role: 'group', 'aria-label': `Room ${room.number}`, 'data-status': room.status, class: 'roomgroup' }, [
      el('span', { class: 'roomnumber', text: room.number }),
      chip,
      el('span', {
        class: 'guestline',
        text: room.arrival !== null && room.departure !== null ? `${room.arrival} to ${room.departure}` : '',
      }),
      el(
        'div',
        { class: 'actions wrap' },
        moves.map((status) =>
          button(
            `Room ${room.number} ${roomStatusWords(status)}`,
            () => void changeRoomStatus(room.roomId, room.number, status, regionNames.boardStatus),
            {
              class: 'touch statusbutton',
              'aria-pressed': room.status === status ? 'true' : 'false',
            },
          ),
        ),
      ),
    ]);
  });

  const stays = (board ? board.rooms : []).filter(
    (room) => room.arrival !== null && room.departure !== null,
  );

  return shell([], [
    el('main', { class: 'boardmain' }, [
      statusRegion(regionNames.boardStatus),
      el('section', { role: 'region', 'aria-label': 'Room board', class: 'roomboard' }, groups),
      el(
        'ul',
        { role: 'list', 'aria-label': "Today's stays", class: 'staylist' },
        stays.map((room) =>
          el('li', { text: `Room ${room.number}: ${room.arrival} to ${room.departure}` }),
        ),
      ),
    ]),
  ]);
}
