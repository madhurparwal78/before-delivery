import type { Board, BoardRoom, RoomStatus } from "../shared/api";
import type { IsoDate } from "../shared/dates";
import { rows, type Queryable, type Row } from "./db";
import { ROOM_ORDER, loadHotel } from "./hotel";

interface BoardRow extends Row {
  room_id: string;
  number: string;
  status: RoomStatus;
  arrival: IsoDate | null;
  departure: IsoDate | null;
}

/** Room, status and the dates of the stay holding the business date: all a housekeeper may see. */
export async function boardRooms(from: Queryable, hotelId: string, roomId?: string): Promise<BoardRoom[]> {
  const found = await rows<BoardRow>(
    from,
    `SELECT r.id AS room_id, r.number, r.status, held.arrival, held.departure
     FROM rooms r JOIN hotels h ON h.id = r.hotel_id
     LEFT JOIN LATERAL (
       SELECT s.arrival, s.departure FROM stay_nights n JOIN stays s ON s.id = n.stay_id
       WHERE n.room_id = r.id AND n.night = h.business_date AND n.holds LIMIT 1
     ) held ON true
     WHERE r.hotel_id = $1 AND ($2::uuid IS NULL OR r.id = $2)
     ORDER BY ${ROOM_ORDER}`,
    [hotelId, roomId ?? null],
  );
  return found.map((row) => ({
    roomId: row.room_id, number: row.number, status: row.status, arrival: row.arrival, departure: row.departure,
  }));
}

export async function boardView(from: Queryable, hotelId: string): Promise<Board> {
  const hotel = await loadHotel(from, hotelId);
  return { businessDate: hotel.businessDate, rooms: await boardRooms(from, hotelId) };
}
