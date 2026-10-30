import type { Hold, HoldStatus } from '../../shared/api.js';
import {
  cellsForSpan,
  computeCost,
  isHoldLive,
  validateHoldPlacement,
  type Station,
} from '../../shared/domain.js';
import { formatMoney } from '../../shared/format.js';
import { formatClock, formatInstant } from '../../shared/time.js';
import { newId } from '../db/seed.js';
import { conflict, invalidField } from '../http/errors.js';
import { insuranceCoversDate } from './documents.js';
import type { Queryable } from './kitchen.js';
import { balanceMinutes } from './ledger.js';

export interface HoldRow {
  id: string;
  member_id: string;
  station_id: string;
  kitchen_date: string;
  start_minutes: number;
  end_minutes: number;
  tail_end_minutes: number;
  status: HoldStatus;
  created_at: Date;
  expires_at: Date;
}

const HOLD_COLUMNS = `id, member_id, station_id, kitchen_date, start_minutes, end_minutes,
  tail_end_minutes, status, created_at, expires_at`;

export async function findHold(db: Queryable, id: string): Promise<HoldRow | null> {
  const result = await db.query<HoldRow>(`SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

/** A stored `live` hold reads `expired` from its expiry instant onwards. */
export function holdStatusAt(row: HoldRow, now: Date): HoldStatus {
  if (row.status === 'live' && !isHoldLive(row.expires_at, now)) return 'expired';
  return row.status;
}

export async function holdView(
  db: Queryable,
  row: HoldRow,
  station: Station,
  now: Date,
  timeZone: string,
): Promise<Hold> {
  const balance = await balanceMinutes(db, row.member_id);
  const cost = computeCost(row.end_minutes - row.start_minutes, balance, station.hourly_rate_cents);
  return {
    id: row.id,
    member_id: row.member_id,
    station_id: row.station_id,
    date: row.kitchen_date,
    start: formatClock(row.start_minutes),
    end: formatClock(row.end_minutes),
    tail_end: formatClock(row.tail_end_minutes),
    status: holdStatusAt(row, now),
    created_at: formatInstant(row.created_at, timeZone),
    expires_at: formatInstant(row.expires_at, timeZone),
    preview: {
      booked_minutes: cost.booked_minutes,
      prepaid_minutes: cost.prepaid_minutes,
      overage_minutes: cost.overage_minutes,
      overage_amount: formatMoney(cost.overage_cents),
    },
  };
}

/**
 * Takes the station's cells for the span. Cells held by an expired hold are
 * taken over; anything else already occupied makes the whole claim fail, so of
 * several concurrent requests exactly one succeeds.
 */
async function claimCells(
  db: Queryable,
  station: string,
  date: string,
  cells: readonly number[],
  owner: { kind: 'hold' | 'booking'; id: string; expiresAt: Date | null },
  now: Date,
): Promise<boolean> {
  if (cells.length === 0) return true;
  const result = await db.query(
    `INSERT INTO cell_locks (station_id, kitchen_date, cell, owner_kind, owner_id, expires_at)
     SELECT $1, $2, c, $4, $5, $6 FROM unnest($3::int[]) AS c
     ON CONFLICT (station_id, kitchen_date, cell) DO UPDATE
        SET owner_kind = EXCLUDED.owner_kind,
            owner_id = EXCLUDED.owner_id,
            expires_at = EXCLUDED.expires_at
      WHERE cell_locks.expires_at IS NOT NULL AND cell_locks.expires_at <= $7
     RETURNING cell`,
    [station, date, cells as number[], owner.kind, owner.id, owner.expiresAt, now],
  );
  return result.rowCount === cells.length;
}

export async function releaseCells(db: Queryable, ownerId: string): Promise<void> {
  await db.query('DELETE FROM cell_locks WHERE owner_id = $1', [ownerId]);
}

export interface PlaceHoldInput {
  memberId: string;
  station: Station;
  date: string;
  startMinutes: number;
  endMinutes: number;
}

export async function placeHold(
  db: Queryable,
  input: PlaceHoldInput,
  now: Date,
  today: string,
  timeZone: string,
  holdSeconds: number,
): Promise<HoldRow> {
  const failure = validateHoldPlacement(
    {
      date: input.date,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      cleaningMinutes: input.station.cleaning_minutes,
    },
    now,
    today,
    timeZone,
  );
  if (failure !== null) throw invalidField(failure.field, failure.code);

  if (!(await insuranceCoversDate(db, input.memberId, input.date))) {
    throw conflict('documents_not_current', { missing: ['liability_insurance'] });
  }

  const tailEnd = input.endMinutes + input.station.cleaning_minutes;
  const expiresAt = new Date(now.getTime() + holdSeconds * 1000);
  const id = newId('hld');

  const inserted = await db.query<HoldRow>(
    `INSERT INTO holds (id, member_id, station_id, kitchen_date, start_minutes, end_minutes,
        tail_end_minutes, status, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'live', $8, $9)
     RETURNING ${HOLD_COLUMNS}`,
    [
      id,
      input.memberId,
      input.station.id,
      input.date,
      input.startMinutes,
      input.endMinutes,
      tailEnd,
      now,
      expiresAt,
    ],
  );

  const claimed = await claimCells(
    db,
    input.station.id,
    input.date,
    cellsForSpan(input.startMinutes, tailEnd),
    { kind: 'hold', id, expiresAt },
    now,
  );
  if (!claimed) throw conflict('slot_taken');

  return inserted.rows[0] as HoldRow;
}

export async function resizeHold(
  db: Queryable,
  row: HoldRow,
  station: Station,
  endMinutes: number,
  now: Date,
  today: string,
  timeZone: string,
): Promise<HoldRow> {
  const failure = validateHoldPlacement(
    {
      date: row.kitchen_date,
      startMinutes: row.start_minutes,
      endMinutes,
      cleaningMinutes: station.cleaning_minutes,
    },
    now,
    today,
    timeZone,
  );
  // A live hold may keep a start that has since passed; only the end moves.
  if (failure !== null && failure.code !== 'in_the_past') {
    throw invalidField(failure.field, failure.code);
  }

  const tailEnd = endMinutes + station.cleaning_minutes;
  const previous = new Set(cellsForSpan(row.start_minutes, row.tail_end_minutes));
  const wanted = cellsForSpan(row.start_minutes, tailEnd);
  const added = wanted.filter((cell) => !previous.has(cell));

  await db.query(
    `DELETE FROM cell_locks
      WHERE owner_id = $1 AND NOT (cell = ANY($2::int[]))`,
    [row.id, wanted],
  );
  const claimed = await claimCells(
    db,
    station.id,
    row.kitchen_date,
    added,
    { kind: 'hold', id: row.id, expiresAt: row.expires_at },
    now,
  );
  if (!claimed) throw conflict('slot_taken');

  const updated = await db.query<HoldRow>(
    `UPDATE holds SET end_minutes = $2, tail_end_minutes = $3 WHERE id = $1
     RETURNING ${HOLD_COLUMNS}`,
    [row.id, endMinutes, tailEnd],
  );
  return updated.rows[0] as HoldRow;
}

/** Guards every action on a hold: live holds only, with the published codes. */
export function assertHoldLive(row: HoldRow, now: Date): void {
  const status = holdStatusAt(row, now);
  if (status === 'expired') throw conflict('hold_expired');
  if (status !== 'live') throw conflict('invalid_transition');
}

export async function markHoldsExpired(db: Queryable, now: Date): Promise<void> {
  const expired = await db.query<{ id: string }>(
    `UPDATE holds SET status = 'expired'
      WHERE status = 'live' AND expires_at <= $1
      RETURNING id`,
    [now],
  );
  for (const row of expired.rows) {
    await db.query(`DELETE FROM cell_locks WHERE owner_kind = 'hold' AND owner_id = $1`, [row.id]);
  }
}
