/**
 * Price lookups on the market clock: the latest ETH tick, the day's last trade
 * and the most recent official close.
 */
import { Transaction } from './db';
import { addDays, dateAtTime, newYorkDateOf, formatDateString } from '../shared/nytime';
import { sessionDayFor } from '../domain/calendar';

export interface TickRecord {
  id: string;
  instrument: 'ETH-USD' | 'VLCH';
  price: string;
  atMs: number;
}

interface TickRow {
  id: string;
  instrument: string;
  price: string;
  at: Date;
}

function toTick(row: TickRow): TickRecord {
  return {
    id: row.id,
    instrument: row.instrument as TickRecord['instrument'],
    price: row.price,
    atMs: row.at.getTime(),
  };
}

export async function latestTickBefore(
  tx: Transaction,
  instrument: 'ETH-USD' | 'VLCH',
  atOrBeforeMs: number,
): Promise<TickRecord | null> {
  const rows = await tx.query<TickRow>(
    `SELECT id, instrument, price, at FROM tick
      WHERE instrument = $1 AND at <= $2
      ORDER BY at DESC, seq DESC LIMIT 1`,
    [instrument, new Date(atOrBeforeMs)],
  );
  const row = rows[0];
  return row ? toTick(row) : null;
}

/** The latest VLCH tick inside the session of the market clock's own date. */
export async function lastTradeInSession(tx: Transaction, atMs: number): Promise<TickRecord | null> {
  const day = sessionDayFor(newYorkDateOf(atMs));
  if (day.opensAt === null || day.closesAt === null) return null;
  if (atMs < day.opensAt || atMs >= day.closesAt) return null;
  const rows = await tx.query<TickRow>(
    `SELECT id, instrument, price, at FROM tick
      WHERE instrument = 'VLCH' AND at >= $1 AND at <= $2
      ORDER BY at DESC, seq DESC LIMIT 1`,
    [new Date(day.opensAt), new Date(atMs)],
  );
  const row = rows[0];
  return row ? toTick(row) : null;
}

/** The greatest session close instant at or before `atMs`. */
export function mostRecentSessionCloseInstant(atMs: number): number | null {
  let cursor = newYorkDateOf(atMs);
  for (let back = 0; back < 400; back += 1) {
    const day = sessionDayFor(cursor);
    if (day.closesAt !== null && day.closesAt <= atMs) return day.closesAt;
    cursor = addDays(cursor, -1);
    if (dateAtTime(cursor, 0, 0, 0) < atMs - 400 * 86_400_000) break;
  }
  return null;
}

export interface OfficialClose {
  date: string;
  price: string;
  closeInstantMs: number;
}

/**
 * The most recent official close at or before `atMs`: the last VLCH tick of the
 * latest trading day whose close instant has passed.
 */
export async function officialCloseAt(tx: Transaction, atMs: number): Promise<OfficialClose | null> {
  const boundary = mostRecentSessionCloseInstant(atMs);
  if (boundary === null) return null;
  const rows = await tx.query<TickRow>(
    `SELECT id, instrument, price, at FROM tick
      WHERE instrument = 'VLCH' AND at < $1
      ORDER BY at DESC, seq DESC LIMIT 1`,
    [new Date(boundary)],
  );
  const row = rows[0];
  if (!row) return null;
  const date = newYorkDateOf(row.at.getTime());
  const day = sessionDayFor(date);
  if (day.closesAt === null) return null;
  return { date: formatDateString(date), price: row.price, closeInstantMs: day.closesAt };
}
