import type { Request, Response } from 'express';
import { withTransaction } from './db.js';
import { err } from './errors.js';
import { hotelNow } from './guards.js';
import { publish } from './live.js';
import type { RoomStatus } from '../shared/types.js';

const STATUSES: RoomStatus[] = ['dirty', 'clean', 'inspected', 'out_of_order'];

/** Allowed status moves by role, exactly as published. */
export function statusMoveAllowed(from: RoomStatus, to: RoomStatus, role: 'owner' | 'front_desk' | 'housekeeper'): boolean {
  if (from === to) return false;
  switch (`${from}->${to}`) {
    case 'dirty->clean':
      return role === 'housekeeper' || role === 'front_desk' || role === 'owner';
    case 'clean->inspected':
      return role === 'front_desk' || role === 'owner';
    case 'inspected->dirty':
    case 'clean->dirty':
      return role === 'housekeeper' || role === 'front_desk' || role === 'owner';
    case 'dirty->out_of_order':
    case 'clean->out_of_order':
    case 'inspected->out_of_order':
      return role === 'owner';
    case 'out_of_order->dirty':
      return role === 'owner';
    default:
      return false;
  }
}

export async function board(req: Request, res: Response) {
  const user = req.user!;
  const hotel = await hotelNow(user.hotelId);
  const { rows } = await withTransaction(async client => {
    const roomsRes = await client.query(
      'SELECT id, number, status FROM rooms WHERE hotel_id = $1 ORDER BY number', [user.hotelId]);
    const out = [];
    for (const room of roomsRes.rows) {
      const stayRes = await client.query(
        `SELECT s.arrival, s.departure FROM stay_nights sn
         JOIN stays s ON s.id = sn.stay_id
         WHERE sn.room_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')
         ORDER BY s.arrival LIMIT 1`,
        [room.id, hotel.businessDate]);
      const stay = stayRes.rows[0];
      out.push({
        roomId: room.id,
        number: room.number,
        status: room.status,
        arrival: stay?.arrival ?? null,
        departure: stay?.departure ?? null
      });
    }
    return { rows: out };
  });
  res.json({ businessDate: hotel.businessDate, rooms: rows });
}

export async function setRoomStatus(req: Request, res: Response) {
  const user = req.user!;
  const status = req.body.status;
  if (typeof status !== 'string' || !STATUSES.includes(status as RoomStatus)) {
    throw err.validation('status', 'That room status change is not allowed.');
  }
  const result = await withTransaction(async client => {
    const roomRes = await client.query('SELECT * FROM rooms WHERE id = $1 AND hotel_id = $2', [req.params.id, user.hotelId]);
    const room = roomRes.rows[0];
    if (!room) throw err.notFound();
    if (!statusMoveAllowed(room.status as RoomStatus, status as RoomStatus, user.role)) {
      throw err.conflict('That room status change is not allowed.');
    }
    await client.query('UPDATE rooms SET status = $1 WHERE id = $2', [status, room.id]);
    const hotel = await hotelNow(user.hotelId);
    const stayRes = await client.query(
      `SELECT s.arrival, s.departure FROM stay_nights sn
       JOIN stays s ON s.id = sn.stay_id
       WHERE sn.room_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')
       ORDER BY s.arrival LIMIT 1`,
      [room.id, hotel.businessDate]);
    const stay = stayRes.rows[0];
    return {
      roomId: room.id, number: room.number, status,
      arrival: stay?.arrival ?? null, departure: stay?.departure ?? null
    };
  });
  publish(user.hotelId, {
    type: 'room', roomId: result.roomId, number: result.number, status: result.status,
    arrival: result.arrival, departure: result.departure,
    notice: `Room ${result.number} is now ${result.status.replace('_', ' ')}.`
  });
  res.json(result);
}

export async function freeRoomsText(hotelId: string): Promise<string> {
  const hotel = await hotelNow(hotelId);
  const counts = await withTransaction(async client => {
    const roomsRes = await client.query(
      'SELECT COUNT(*)::int AS n FROM rooms WHERE hotel_id = $1 AND status <> $2', [hotelId, 'out_of_order']);
    const heldRes = await client.query(
      `SELECT COUNT(DISTINCT sn.room_id)::int AS n FROM stay_nights sn
       JOIN stays s ON s.id = sn.stay_id
       WHERE sn.hotel_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')`,
      [hotelId, hotel.businessDate]);
    return { rooms: roomsRes.rows[0].n, held: heldRes.rows[0].n };
  });
  const free = Math.max(0, counts.rooms - counts.held);
  return `${free} rooms free tonight`;
}
