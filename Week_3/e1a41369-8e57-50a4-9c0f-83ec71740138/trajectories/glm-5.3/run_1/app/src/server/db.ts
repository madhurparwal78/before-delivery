import pg from 'pg';
import { bandOf, experienceToLevel } from '../shared/rules.js';
import { closeInstantFor, nextDayStartText, weekdayOf } from './time.js';
import type { Band, Difficulty, TaskType, Weekday } from '../shared/rules.js';
import type { ChecklistItem, Notice, Player, Task } from '../shared/types.js';
import type { Pool, QueryResult } from 'pg';

export const pool: Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export function tenths(x: string | number): number {
  return Math.round(Number(x) * 10);
}

export function fromTenths(t: number): number {
  return Math.round(t) / 10;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface UserRow {
  id: string;
  username: string;
  level: number;
  experience: number;
  health: string;
  gold_cents: number;
  time_zone: string;
  day_start_hour: number;
  resting: boolean;
  open_date: Date;
  password_hash: string;
}

/** Serialize a user row into the public Player shape. */
export function playerFromRow(row: UserRow, partyId: string | null, notices: Notice[]): Player {
  const today = isoDate(row.open_date);
  const closeAt = closeInstantFor(today, row.time_zone, row.day_start_hour);
  return {
    id: row.id,
    username: row.username,
    level: row.level,
    experience: row.experience,
    experienceToLevel: experienceToLevel(row.level),
    health: fromTenths(tenths(row.health)),
    maxHealth: 50.0,
    gold: row.gold_cents / 100,
    timeZone: row.time_zone,
    dayStartHour: row.day_start_hour,
    resting: row.resting,
    today,
    nextCloseAt: closeAt.toISOString(),
    nextDayStart: nextDayStartText(closeAt, row.time_zone),
    partyId,
    notices,
  };
}

export interface TaskRow {
  id: string;
  owner_id: string;
  type: TaskType;
  title: string;
  difficulty: Difficulty;
  value: number;
  streak: number;
  done: boolean;
  done_at: Date | null;
  position: number;
  weekdays: string[] | null;
  price_cents: number | null;
  updated_at: Date;
}


/**
 * Serialize a task row. `dueToday` is only meaningful for dailies and is
 * decided by the caller from the owner's open local date, never the device
 * clock.
 */
export function taskFromRow(
  row: TaskRow,
  checklist: ChecklistItem[] | null,
  dueToday: boolean | null
): Task {
  const band: Band = bandOf(row.value).band;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    difficulty: row.difficulty,
    value: row.value,
    band,
    streak: row.streak,
    done: row.done,
    dueToday,
    weekdays: row.weekdays ? (row.weekdays as Weekday[]) : null,
    checklist,
    price: row.price_cents === null ? null : row.price_cents / 100,
    position: row.position,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

export async function q1<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const r = await q<T>(text, params);
  return r.rows[0] ?? null;
}

/** A daily is due on local date D when D's weekday is one of its weekdays. */
export function isDueOn(weekdays: string[] | null, dateISO: string, ownerZone: string): boolean {
  if (!weekdays) return false;
  return weekdays.includes(weekdayOf(dateISO, ownerZone));
}

/** Load checklist items for the given task ids, in position order. */
export async function loadChecklists(taskIds: string[]): Promise<Map<string, ChecklistItem[]>> {
  const map = new Map<string, ChecklistItem[]>();
  if (taskIds.length === 0) return map;
  const r = await q<{ id: string; task_id: string; text: string; checked: boolean }>(
    `SELECT id, task_id, text, checked FROM checklist_items WHERE task_id = ANY($1::uuid[]) ORDER BY position`,
    [taskIds]
  );
  for (const row of r.rows) {
    const list = map.get(row.task_id) ?? [];
    list.push({ id: row.id, text: row.text, checked: row.checked });
    map.set(row.task_id, list);
  }
  return map;
}
