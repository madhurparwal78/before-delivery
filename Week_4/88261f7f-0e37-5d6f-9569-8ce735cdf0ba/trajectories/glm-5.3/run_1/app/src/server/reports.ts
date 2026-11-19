import type { Request, Response } from 'express';
import type pg from 'pg';
import { pool } from './db.js';
import { err } from './errors.js';
import { isValidDate, compareDates, addDays } from './dates.js';
import { halfUp } from '../shared/format.js';
import type { NightFigures, ReportFigures } from '../shared/types.js';

export interface RawFigures {
  date: string;
  roomsAvailable: number;
  roomsSold: number;
  roomRevenueCents: number;
}

export async function computeNightFigures(client: pg.PoolClient, hotelId: string, from: string, to: string): Promise<RawFigures[]> {
  const out: RawFigures[] = [];
  const hotelRes = await client.query('SELECT business_date FROM hotels WHERE id = $1', [hotelId]);
  const businessDate = hotelRes.rows[0].business_date;
  let date = from;
  while (compareDates(date, to) <= 0) {
    const closedRes = await client.query(
      'SELECT * FROM closed_nights WHERE hotel_id = $1 AND date = $2', [hotelId, date]);
    if (closedRes.rows[0]) {
      out.push({
        date,
        roomsAvailable: closedRes.rows[0].rooms_available,
        roomsSold: closedRes.rows[0].rooms_sold,
        roomRevenueCents: closedRes.rows[0].room_revenue_cents
      });
    } else {
      const totalRes = await client.query('SELECT COUNT(*)::int AS total FROM rooms WHERE hotel_id = $1', [hotelId]);
      // An open night uses rooms out of order now: if the night is the business date or later
      const isCurrentNight = compareDates(date, businessDate) >= 0;
      const available = isCurrentNight
        ? (await client.query(
            'SELECT COUNT(*)::int AS n FROM rooms WHERE hotel_id = $1 AND status <> $2',
            [hotelId, 'out_of_order'])).rows[0].n
        : totalRes.rows[0].total;
      const soldRes = await client.query(
        `SELECT COUNT(DISTINCT sn.stay_id)::int AS n
         FROM stay_nights sn JOIN stays s ON s.id = sn.stay_id
         WHERE sn.hotel_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')`,
        [hotelId, date]);
      const revenueRes = await client.query(
        `SELECT COALESCE(SUM(sn.room_cents), 0)::int AS n
         FROM stay_nights sn JOIN stays s ON s.id = sn.stay_id
         WHERE sn.hotel_id = $1 AND sn.date = $2 AND s.status IN ('booked','in_house')`,
        [hotelId, date]);
      out.push({
        date,
        roomsAvailable: available,
        roomsSold: soldRes.rows[0].n,
        roomRevenueCents: revenueRes.rows[0].n
      });
    }
    date = addDays(date, 1);
  }
  return out;
}

export function serializeFigures(f: RawFigures): ReportFigures {
  const { roomsAvailable, roomsSold, roomRevenueCents } = f;
  const occupancy = roomsAvailable === 0
    ? '—'
    : formatPercent(halfUp(roomsSold * 1000, roomsAvailable));
  const averageDailyRate = roomsSold === 0
    ? '—'
    : formatMoney(halfUp(roomRevenueCents, roomsSold));
  const revenuePerAvailableRoom = roomsAvailable === 0
    ? '—'
    : formatMoney(halfUp(roomRevenueCents, roomsAvailable));
  return { roomsAvailable, roomsSold, roomRevenueCents, occupancy, averageDailyRate, revenuePerAvailableRoom };
}

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  return `${negative ? '-$' : '$'}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatPercent(tenths: number): string {
  return `${(tenths / 10).toFixed(1)}%`;
}

export async function reports(req: Request, res: Response) {
  const user = req.user!;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if (typeof from !== 'string' || typeof to !== 'string' || !isValidDate(from) || !isValidDate(to) || compareDates(from, to) > 0) {
    throw err.validation('from', 'Enter a valid date range.');
  }
  const nights = countNights(from, to);
  if (nights > 366) throw err.validation('from', 'Enter a valid date range.');

  const client = await pool.connect();
  try {
    const raw = await computeNightFigures(client, user.hotelId, from, to);
    const perNight: NightFigures[] = raw.map(f => ({ ...serializeFigures(f), date: f.date }));
    const roomsAvailable = raw.reduce((s, f) => s + f.roomsAvailable, 0);
    const roomsSold = raw.reduce((s, f) => s + f.roomsSold, 0);
    const roomRevenueCents = raw.reduce((s, f) => s + f.roomRevenueCents, 0);
    const total: RawFigures = { date: '', roomsAvailable, roomsSold, roomRevenueCents };
    res.json({
      from, to,
      ...serializeFigures(total),
      nights: perNight
    });
  } finally {
    client.release();
  }
}

function countNights(from: string, to: string): number {
  let count = 0;
  let date = from;
  while (compareDates(date, to) <= 0) { count++; date = addDays(date, 1); }
  return count;
}
