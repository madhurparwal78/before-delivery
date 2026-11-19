import { notices, pendingTexts } from '../../shared/notices';
import { call } from '../api';
import { loadBoard, loadDesk, render, state } from '../app';
import { openDialogFor } from '../dialog';
import { button, el } from '../dom';
import { regionNames, setMessage } from '../regions';
import {
  ROOM_STATUSES,
  RoomStatus,
  roomStatusLabel,
  roomStatusWords,
} from '../../shared/roomStatus';
import { BoardRoom } from '../types';

export async function changeRoomStatus(
  roomId: string,
  roomNumber: string,
  status: RoomStatus,
  region: string,
): Promise<void> {
  setMessage(region, pendingTexts.roomStatus);
  const result = await call<BoardRoom>(`/api/rooms/${roomId}/status`, {
    method: 'POST',
    body: { status },
  });
  if (result.data) {
    setMessage(region, notices.roomStatus(roomNumber, roomStatusWords(status)));
  } else {
    setMessage(region, result.error ?? 'Not found.');
  }
  if (state.route === '/board') await loadBoard();
  if (state.user && state.user.role !== 'housekeeper') await loadDesk();
  render();
}

export function openRoomStatus(
  opener: HTMLElement | null,
  room: { id: string; number: string; status: string },
  restoreFocus?: () => void,
): void {
  const handle = openDialogFor({
    name: 'Room status',
    opener,
    restoreFocus,
    className: 'panel',
    build: (dialog) => [
      el('h2', { text: `Room ${room.number}` }),
      el(
        'div',
        { class: 'actions wrap' },
        ROOM_STATUSES.map((status) =>
          button(
            roomStatusLabel(status),
            () => {
              dialog.close();
              void changeRoomStatus(room.id, room.number, status, regionNames.deskNotices);
            },
            { 'aria-pressed': room.status === status ? 'true' : 'false', class: 'statusbutton' },
          ),
        ),
      ),
      el('div', { class: 'actions' }, [button('Close', () => dialog.close())]),
    ],
  });
  void handle;
}
