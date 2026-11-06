import { randomUUID } from 'node:crypto';
import {
  SLOT_NOTICE_SECONDS,
  slotTimeOptions,
  isOpenRelease,
} from '../../shared/releasestates';
import {
  localToSlot,
  parseLocalSlot,
  slotLabel,
  weekdayOf,
  zurichParts,
  zurichToInstant,
  type LocalFields,
} from '../../shared/zurich';
import type { Release, ReleaseStatus } from '../../shared/types';
import { query, type QueryValue, type Tx } from '../db';
import { carName } from './cars';
import { holdingInvoicesFor } from './invoices';

export interface ReleaseRow {
  id: string;
  car_id: string;
  owner_id: string;
  owner_name: string;
  car_year: number;
  car_make: string;
  car_model: string;
  slot: string;
  slot_at: Date;
  status: ReleaseStatus;
  bay_code: string | null;
  current_bay_code: string | null;
}

export const RELEASE_SELECT = `
  select r.*, u.name as owner_name, c.year as car_year, c.make as car_make, c.model as car_model,
    b.code as current_bay_code
  from releases r
  join users u on u.id = r.owner_id
  join cars c on c.id = r.car_id
  left join bays b on b.id = c.bay_id`;

export type SlotProblem = 'format' | 'grid' | 'notice';

export interface ValidSlot {
  readonly fields: LocalFields;
  readonly slot: string;
  readonly at: Date;
}

/** The single decision on whether a release slot is allowed. */
export function checkSlot(raw: unknown, now: Date): ValidSlot | SlotProblem {
  if (typeof raw !== 'string') return 'format';
  const fields = parseLocalSlot(raw.trim());
  if (fields === null) return 'format';
  const onGrid =
    (fields.minute === 0 || fields.minute === 30) &&
    fields.hour >= 8 &&
    (fields.hour < 17 || (fields.hour === 17 && fields.minute <= 30)) &&
    weekdayOf(fields) >= 1 &&
    weekdayOf(fields) <= 6;
  if (!onGrid) return 'grid';
  const at = zurichToInstant(fields);
  if (at.getTime() - now.getTime() < SLOT_NOTICE_SECONDS * 1000) return 'notice';
  return { fields, slot: localToSlot(fields), at };
}

/** The earliest slot on the grid that meets the notice. */
export function earliestSlot(now: Date): { slot: string; label: string } {
  const from = new Date(now.getTime() + SLOT_NOTICE_SECONDS * 1000);
  const times = slotTimeOptions();
  const start = zurichParts(from);
  for (let dayOffset = 0; dayOffset < 21; dayOffset += 1) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + dayOffset));
    const base: LocalFields = {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
      hour: 0,
      minute: 0,
    };
    if (weekdayOf(base) < 1 || weekdayOf(base) > 6) continue;
    for (const time of times) {
      const [hour = '0', minute = '0'] = time.split(':');
      const candidate: LocalFields = { ...base, hour: Number(hour), minute: Number(minute) };
      if (zurichToInstant(candidate).getTime() >= from.getTime()) {
        const slot = localToSlot(candidate);
        return { slot, label: slotLabel(slot) };
      }
    }
  }
  throw new Error('no slot meets the notice');
}

interface EventRow {
  status: ReleaseStatus;
  at: Date;
  by_user: string;
  by_name: string;
}

export async function toRelease(row: ReleaseRow): Promise<Release> {
  const events = await query<EventRow>(
    `select e.status, e.at, e.by_user, u.name as by_name
     from release_events e join users u on u.id = e.by_user
     where e.release_id = $1 order by e.at, e.id`,
    [row.id],
  );
  const open = isOpenRelease(row.status);
  const heldBy = open ? await holdingInvoicesFor(row.car_id) : [];
  return {
    id: row.id,
    car: {
      id: row.car_id,
      name: carName({ year: row.car_year, make: row.car_make, model: row.car_model }),
    },
    owner: { id: row.owner_id, name: row.owner_name },
    slot: row.slot,
    slot_label: slotLabel(row.slot),
    status: row.status,
    bay_code: row.current_bay_code ?? row.bay_code,
    held_by: heldBy,
    events: events.map((event) => ({
      status: event.status,
      at: event.at.toISOString(),
      by: { id: event.by_user, name: event.by_name },
    })),
  };
}

export async function loadReleaseRow(
  releaseId: string,
  ownerId: string | null,
): Promise<ReleaseRow | null> {
  const values: QueryValue[] = [releaseId];
  let where = 'where r.id = $1';
  if (ownerId !== null) {
    values.push(ownerId);
    where += ' and r.owner_id = $2';
  }
  const rows = await query<ReleaseRow>(`${RELEASE_SELECT} ${where}`, values);
  return rows[0] ?? null;
}

export async function loadReleaseRows(ownerId: string | null): Promise<ReleaseRow[]> {
  const values: QueryValue[] = [];
  let where = '';
  if (ownerId !== null) {
    values.push(ownerId);
    where = 'where r.owner_id = $1';
  }
  return query<ReleaseRow>(`${RELEASE_SELECT} ${where} order by r.slot_at desc`, values);
}

export async function appendEvent(
  tx: Tx,
  releaseId: string,
  status: ReleaseStatus,
  byUser: string,
  at: Date,
): Promise<void> {
  await tx.query(
    'insert into release_events (id, release_id, status, at, by_user) values ($1,$2,$3,$4,$5)',
    [randomUUID(), releaseId, status, at, byUser],
  );
}
