import { Db, one, pool, withTransaction } from '../db';
import { PlainDate } from '../../shared/dates';
import { notices } from '../../shared/notices';
import { BOARD_ROLES } from '../domain/roles';
import { mayChangeRoomStatus } from '../domain/roomStatus';
import { isRoomStatus, RoomStatus, roomStatusWords } from '../../shared/roomStatus';
import { errorTexts, failure, invalid, notFoundError } from '../http/errors';
import { Router } from '../http/router';
import { Hotel, listRooms, loadRoom, setRoomStatus } from '../repo/hotels';
import { HousekeeperChange, publishChange, StaffChange } from '../services/live';
import { hotelOf, signedInUser, textField } from './support';

/** The only fields a housekeeper is ever told about a room. */
export interface BoardRoom {
  roomId: string;
  number: string;
  status: RoomStatus;
  arrival: PlainDate | null;
  departure: PlainDate | null;
}

async function stayDatesOnNight(
  db: Db,
  roomId: string,
  date: PlainDate,
): Promise<{ arrival: PlainDate; departure: PlainDate } | null> {
  const row = await one<{ arrival: string; departure: string }>(
    db,
    `select s.arrival, s.departure
       from stay_segments sg join stays s on s.id = sg.stay_id
      where sg.room_id = $1
        and s.status in ('booked','in_house','checked_out')
        and sg.first_night <= $2::date and $2::date < sg.first_night + sg.nights
      limit 1`,
    [roomId, date],
  );
  return row ? { arrival: row.arrival, departure: row.departure } : null;
}

async function boardRoom(
  db: Db,
  hotel: Hotel,
  room: { id: string; number: string; status: RoomStatus },
): Promise<BoardRoom> {
  const dates = await stayDatesOnNight(db, room.id, hotel.businessDate);
  return {
    roomId: room.id,
    number: room.number,
    status: room.status,
    arrival: dates ? dates.arrival : null,
    departure: dates ? dates.departure : null,
  };
}

export async function roomChangeEvents(
  db: Db,
  hotel: Hotel,
  roomId: string,
  notice: string | null,
): Promise<{ staff: StaffChange; housekeeper: HousekeeperChange }> {
  const room = await loadRoom(db, hotel.id, roomId);
  const board = room
    ? await boardRoom(db, hotel, room)
    : { roomId, number: '', status: 'dirty' as RoomStatus, arrival: null, departure: null };
  return {
    staff: { type: 'room', roomId, notice },
    housekeeper: {
      type: 'room',
      roomId: board.roomId,
      number: board.number,
      status: board.status,
      arrival: board.arrival,
      departure: board.departure,
      notice,
    },
  };
}

export function registerHousekeepingRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/housekeeping/board',
    access: BOARD_ROLES,
    bodyMode: 'none',
    handler: async (ctx) => {
      const hotel = await hotelOf(ctx);
      const rooms = await listRooms(pool, hotel.id);
      const board: BoardRoom[] = [];
      for (const room of rooms) board.push(await boardRoom(pool, hotel, room));
      return { status: 200, json: { businessDate: hotel.businessDate, rooms: board } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/rooms/:id/status',
    access: BOARD_ROLES,
    bodyMode: 'json',
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const hotel = await hotelOf(ctx);
      const room = await loadRoom(pool, hotel.id, ctx.params.id);
      if (!room) throw notFoundError();
      const status = textField(ctx.body, 'status');
      if (!isRoomStatus(status)) throw invalid({ status: 'Choose a room status.' });
      if (!mayChangeRoomStatus(user.role, room.status, status)) {
        throw failure(409, errorTexts.statusChangeNotAllowed);
      }
      const board = await withTransaction(async (db) => {
        await setRoomStatus(db, room.id, status);
        const notice = notices.roomStatus(room.number, roomStatusWords(status));
        const events = await roomChangeEvents(db, hotel, room.id, notice);
        await publishChange(db, hotel.id, events.staff, events.housekeeper);
        return boardRoom(db, hotel, { ...room, status });
      });
      return { status: 200, json: board };
    },
  });
}
