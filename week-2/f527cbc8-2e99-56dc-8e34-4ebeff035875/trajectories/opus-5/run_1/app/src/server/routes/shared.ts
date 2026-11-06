import { query, queryOne, type Db } from '../db.js';
import { notFound, ValidationError, fieldMessages } from '../errors.js';
import type { Caller } from '../auth.js';
import {
  loadBarnDay,
  bookedCount,
  derivedStatus,
  slotsWithState,
  barnDayJson,
  type BarnDayRow,
  type DayStatus,
} from '../domain/barndays.js';
import { nextDue, type DueStatus } from '../domain/nextdue.js';
import { practice, practiceToday } from '../domain/practice.js';

/**
 * Visibility. An id the caller may not see answers 404 even when guessed, so every
 * lookup goes through one of these.
 */
export async function ownerKeepsHorseAtBarn(
  db: Db,
  ownerId: string,
  barnId: string,
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    db,
    'SELECT id FROM horses WHERE owner_id = $1 AND barn_id = $2 LIMIT 1',
    [ownerId, barnId],
  );
  return row !== null;
}

/** The barn days a caller's rail lists, which are exactly the days they may read by id. */
export async function visibleBarnDay(
  db: Db,
  caller: Caller,
  barnDayId: string,
  at: Date,
  lock = false,
): Promise<BarnDayRow> {
  const day = await loadBarnDay(db, barnDayId, lock);
  if (day === null) throw notFound();
  const booked = await bookedCount(db, day.id, at);
  const status = derivedStatus(day.status, booked, day.slot_count);

  switch (caller.role) {
    case 'farrier':
    case 'apprentice':
      if (day.status === 'cancelled') return day;
      return day;
    case 'owner': {
      if (status !== 'published' && status !== 'full' && status !== 'in_progress') throw notFound();
      if (!(await ownerKeepsHorseAtBarn(db, caller.userId, day.barn_id))) throw notFound();
      return day;
    }
    case 'barn_manager': {
      const allowed: DayStatus[] = ['published', 'full', 'in_progress', 'closed'];
      if (!allowed.includes(status)) throw notFound();
      if (caller.barnId !== day.barn_id) throw notFound();
      return day;
    }
  }
}

export interface HorseRow {
  id: string;
  name: string;
  barn_id: string;
  barn_name: string;
  stall: string;
  cycle_weeks: number;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string | null;
}

export const HORSE_COLUMNS = `h.id, h.name, h.barn_id, b.name AS barn_name, h.stall, h.cycle_weeks,
  h.owner_id, o.name AS owner_name, o.email AS owner_email, o.phone AS owner_phone`;

export async function visibleHorse(db: Db, caller: Caller, horseId: string): Promise<HorseRow> {
  const horse = await queryOne<HorseRow>(
    db,
    `SELECT ${HORSE_COLUMNS} FROM horses h
     JOIN barns b ON b.id = h.barn_id JOIN users o ON o.id = h.owner_id
     WHERE h.id = $1`,
    [horseId],
  );
  if (horse === null) throw notFound();
  if (caller.role === 'owner' && horse.owner_id !== caller.userId) throw notFound();
  if (caller.role === 'barn_manager') throw notFound();
  return horse;
}

export async function horseJson(db: Db, horse: HorseRow, forFarrier: boolean): Promise<Record<string, unknown>> {
  const today = await practiceToday(db);
  const last = await queryOne<{ business_date: string }>(
    db,
    `SELECT to_char(business_date,'YYYY-MM-DD') AS business_date FROM visits
     WHERE horse_id = $1 AND status <> 'open' ORDER BY business_date DESC LIMIT 1`,
    [horse.id],
  );
  const due = nextDue(last?.business_date ?? null, horse.cycle_weeks, today);
  const body: Record<string, unknown> = {
    id: horse.id,
    name: horse.name,
    barn: { id: horse.barn_id, name: horse.barn_name },
    stall: horse.stall,
    cycle_weeks: horse.cycle_weeks,
    last_worked_date: due.lastWorkedDate,
    next_due_date: due.nextDueDate,
    due_status: due.dueStatus satisfies DueStatus,
  };
  if (forFarrier) {
    body.owner = {
      id: horse.owner_id,
      name: horse.owner_name,
      email: horse.owner_email,
      phone: horse.owner_phone,
    };
  }
  return body;
}

export async function barnDayBody(
  db: Db,
  caller: Caller,
  day: BarnDayRow,
  at: Date,
): Promise<Record<string, unknown>> {
  const { timeZone } = await practice(db);
  const booked = await bookedCount(db, day.id, at);
  const status = derivedStatus(day.status, booked, day.slot_count);
  const slots = await slotsWithState(db, day.id, at);
  const isManager = caller.role === 'barn_manager';
  return barnDayJson(day, {
    booked,
    status,
    timeZone,
    includeTripFee: !isManager,
    includeMyBooking: !isManager,
    slots: slots.map((slot) => ({
      id: slot.id,
      time: slot.slot_time,
      state: slot.booking_id === null ? 'open' : 'taken',
      myBookingId:
        slot.booking_id !== null && slot.booking_owner_id === caller.userId ? slot.booking_id : null,
    })),
  });
}

/** The days a caller's rail lists. */
export async function railBarnDayIds(db: Db, caller: Caller): Promise<string[]> {
  switch (caller.role) {
    case 'farrier':
    case 'apprentice': {
      const rows = await query<{ id: string }>(
        db,
        `SELECT id FROM barn_days WHERE status <> 'cancelled' ORDER BY business_date, start_time`,
      );
      return rows.map((row) => row.id);
    }
    case 'owner': {
      const rows = await query<{ id: string }>(
        db,
        `SELECT d.id FROM barn_days d
         WHERE d.status IN ('published','in_progress')
           AND EXISTS (SELECT 1 FROM horses h WHERE h.owner_id = $1 AND h.barn_id = d.barn_id)
         ORDER BY d.business_date, d.start_time`,
        [caller.userId],
      );
      return rows.map((row) => row.id);
    }
    case 'barn_manager': {
      const rows = await query<{ id: string }>(
        db,
        `SELECT id FROM barn_days
         WHERE barn_id = $1 AND status IN ('published','in_progress','closed')
         ORDER BY business_date, start_time`,
        [caller.barnId],
      );
      return rows.map((row) => row.id);
    }
  }
}

export function readInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError({ [field]: fieldMessages.required });
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError({ [field]: fieldMessages.range(min, max) });
  }
  return parsed;
}

export function readText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError({ [field]: fieldMessages.required });
  }
  const text = value.trim();
  if (text.length > maxLength) throw new ValidationError({ [field]: fieldMessages.required });
  return text;
}
