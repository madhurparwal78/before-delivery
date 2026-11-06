// The board's visibility rules (DP-03): each station's segments depend on
// who is looking. Everything belonging to another member collapses to an
// anonymous occupied span.

import { pool } from '../db.js';
import { clockFromMinutes } from '../../shared/rules.js';
import { instantInZone, kitchenNow, KITCHEN_TZ } from '../clock.js';
import type { User, AnySegment } from '../../shared/types.js';

interface HoldSeg {
  kind: 'hold';
  id: string;
  start: string;
  end: string;
  tail_end: string;
  status: string;
  expires_at: string;
  member_id?: string;
  business_name?: string;
}

interface BookingSeg {
  kind: 'booking';
  id: string;
  start: string;
  end: string;
  tail_end: string;
  status: string;
  payment: string;
  member_id?: string;
  business_name?: string;
}

export async function boardSegments(user: User, date: string, now: ReturnType<typeof kitchenNow>): Promise<Record<string, AnySegment[]>> {
  const isOperator = user.role === 'operator';
  const memberId = user.member_id;

  // Live holds whose expiry has not passed; expired and released holds and
  // cancelled bookings never appear on the board.
  const holds = await pool.query(
    `SELECT id, member_id, station_id, start_min, end_min, tail_end_min, status, expires_at
     FROM holds
     WHERE date = $1 AND status = 'live' AND expires_at > $2`,
    [date, new Date(now.epochMillis)],
  );
  const bookings = await pool.query(
    `SELECT id, member_id, station_id, start_min, end_min, tail_end_min, status, payment
     FROM bookings
     WHERE date = $1 AND status IN ('confirmed', 'checked_in', 'completed')`,
    [date],
  );

  const out: Record<string, AnySegment[]> = {};
  for (const h of holds.rows as { id: string; member_id: string; station_id: string; start_min: number; end_min: number; tail_end_min: number; status: string; expires_at: Date }[]) {
    const own = !isOperator && memberId === h.member_id;
    if (isOperator) {
      const member = await memberName(h.member_id);
      out[h.station_id] = out[h.station_id] ?? [];
      (out[h.station_id] as HoldSeg[]).push({
        kind: 'hold',
        id: h.id,
        member_id: h.member_id,
        business_name: member,
        start: clockFromMinutes(h.start_min),
        end: clockFromMinutes(h.end_min),
        tail_end: clockFromMinutes(h.tail_end_min),
        status: h.status,
        expires_at: instantInZone(h.expires_at.getTime(), KITCHEN_TZ),
      });
    } else if (own) {
      out[h.station_id] = out[h.station_id] ?? [];
      (out[h.station_id] as HoldSeg[]).push({
        kind: 'hold',
        id: h.id,
        start: clockFromMinutes(h.start_min),
        end: clockFromMinutes(h.end_min),
        tail_end: clockFromMinutes(h.tail_end_min),
        status: h.status,
        expires_at: instantInZone(h.expires_at.getTime(), KITCHEN_TZ),
      });
    } else {
      out[h.station_id] = out[h.station_id] ?? [];
      out[h.station_id]!.push({
        kind: 'occupied',
        start: clockFromMinutes(h.start_min),
        end: clockFromMinutes(h.tail_end_min),
      });
    }
  }

  for (const b of bookings.rows as { id: string; member_id: string; station_id: string; start_min: number; end_min: number; tail_end_min: number; status: string; payment: string }[]) {
    const own = !isOperator && memberId === b.member_id;
    if (isOperator) {
      const member = await memberName(b.member_id);
      out[b.station_id] = out[b.station_id] ?? [];
      (out[b.station_id] as BookingSeg[]).push({
        kind: 'booking',
        id: b.id,
        member_id: b.member_id,
        business_name: member,
        start: clockFromMinutes(b.start_min),
        end: clockFromMinutes(b.end_min),
        tail_end: clockFromMinutes(b.tail_end_min),
        status: b.status,
        payment: b.payment,
      });
    } else if (own) {
      out[b.station_id] = out[b.station_id] ?? [];
      (out[b.station_id] as BookingSeg[]).push({
        kind: 'booking',
        id: b.id,
        start: clockFromMinutes(b.start_min),
        end: clockFromMinutes(b.end_min),
        tail_end: clockFromMinutes(b.tail_end_min),
        status: b.status,
        payment: b.payment,
      });
    } else {
      out[b.station_id] = out[b.station_id] ?? [];
      out[b.station_id]!.push({
        kind: 'occupied',
        start: clockFromMinutes(b.start_min),
        end: clockFromMinutes(b.tail_end_min),
      });
    }
  }

  // Sort every station's segments by start time.
  for (const key of Object.keys(out)) {
    out[key]!.sort((a, c) => a.start.localeCompare(c.start));
  }
  return out;
}

async function memberName(memberId: string): Promise<string> {
  const q = await pool.query('SELECT business_name FROM members WHERE id = $1', [memberId]);
  return (q.rows[0] as { business_name: string } | undefined)?.business_name ?? '';
}
