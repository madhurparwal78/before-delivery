import type { BookingStatus, BoardStation, PaymentStatus, Segment } from '../../shared/api.js';
import { formatClock, formatInstant } from '../../shared/time.js';
import type { SessionUser } from '../http/context.js';
import type { HoldRow } from './holds.js';
import { listStations, type Queryable } from './kitchen.js';

interface BoardBookingRow {
  id: string;
  member_id: string;
  business_name: string;
  station_id: string;
  start_minutes: number;
  end_minutes: number;
  tail_end_minutes: number;
  status: string;
  payment: string;
}

interface BoardHoldRow extends HoldRow {
  business_name: string;
}

/**
 * What each role may see. A member's or crew cook's board shows other
 * members' holds, bookings and cleaning tails only as anonymous occupied
 * spans: no id, member, name or status leaks.
 */
export async function buildBoard(
  db: Queryable,
  date: string,
  viewer: SessionUser,
  now: Date,
  timeZone: string,
): Promise<BoardStation[]> {
  const stations = await listStations(db);

  const holds = await db.query<BoardHoldRow>(
    `SELECT h.id, h.member_id, h.station_id, h.kitchen_date, h.start_minutes, h.end_minutes,
            h.tail_end_minutes, h.status, h.created_at, h.expires_at, m.business_name
       FROM holds h JOIN members m ON m.id = h.member_id
      WHERE h.kitchen_date = $1 AND h.status = 'live' AND h.expires_at > $2
      ORDER BY h.start_minutes`,
    [date, now],
  );

  const bookings = await db.query<BoardBookingRow>(
    `SELECT b.id, b.member_id, m.business_name, b.station_id, b.start_minutes, b.end_minutes,
            b.tail_end_minutes, b.status, b.payment
       FROM bookings b JOIN members m ON m.id = b.member_id
      WHERE b.kitchen_date = $1 AND b.status NOT IN ('cancelled_free', 'cancelled_with_fee')
      ORDER BY b.start_minutes`,
    [date],
  );

  const isOperator = viewer.role === 'operator';
  const ownMemberId = viewer.member_id;

  return stations.map((station) => {
    const segments: Segment[] = [];

    for (const hold of holds.rows) {
      if (hold.station_id !== station.id) continue;
      const mine = hold.member_id === ownMemberId;
      if (isOperator) {
        segments.push({
          kind: 'hold',
          id: hold.id,
          start: formatClock(hold.start_minutes),
          end: formatClock(hold.end_minutes),
          tail_end: formatClock(hold.tail_end_minutes),
          status: 'live',
          expires_at: formatInstant(hold.expires_at, timeZone),
          member_id: hold.member_id,
          business_name: hold.business_name,
        });
      } else if (mine && viewer.role === 'member') {
        segments.push({
          kind: 'hold',
          id: hold.id,
          start: formatClock(hold.start_minutes),
          end: formatClock(hold.end_minutes),
          tail_end: formatClock(hold.tail_end_minutes),
          status: 'live',
          expires_at: formatInstant(hold.expires_at, timeZone),
        });
      } else {
        segments.push({
          kind: 'occupied',
          start: formatClock(hold.start_minutes),
          end: formatClock(hold.tail_end_minutes),
        });
      }
    }

    for (const booking of bookings.rows) {
      if (booking.station_id !== station.id) continue;
      const mine = booking.member_id === ownMemberId;
      if (isOperator || mine) {
        segments.push({
          kind: 'booking',
          id: booking.id,
          start: formatClock(booking.start_minutes),
          end: formatClock(booking.end_minutes),
          tail_end: formatClock(booking.tail_end_minutes),
          status: booking.status as BookingStatus,
          payment: booking.payment as PaymentStatus,
          ...(isOperator
            ? { member_id: booking.member_id, business_name: booking.business_name }
            : {}),
        });
      } else {
        segments.push({
          kind: 'occupied',
          start: formatClock(booking.start_minutes),
          end: formatClock(booking.tail_end_minutes),
        });
      }
    }

    segments.sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
    return { id: station.id, name: station.name, segments };
  });
}
