import type { PoolClient } from 'pg';
import {
  addOfficeDays,
  officeBusinessDaysAfter,
  officeDate,
  officeLocalToInstant,
  officeOffset,
  officeTimeOfDay,
  type OfficeDate,
} from '../officeTime.js';
import { newId } from '../secretStore.js';
import type { AuditWriter } from '../audit.js';

export type RotationRow = {
  id: string;
  credential_id: string;
  interval_days: number;
  at_time: string;
  first_run_on: string;
  created_at: Date;
};

export type Run = {
  office_date: OfficeDate;
  office_time: string;
  offset: string;
  at: Date;
  shifted: boolean;
};

function daysBetween(from: OfficeDate, to: OfficeDate): number {
  const left = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const right = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((right - left) / 86_400_000);
}

/** One run of a schedule, keeping its office wall-clock time across the clock changes. */
export function runOn(rotation: RotationRow, runDate: OfficeDate): Run {
  const resolved = officeLocalToInstant(runDate, rotation.at_time);
  return {
    office_date: officeDate(resolved.at),
    office_time: officeTimeOfDay(resolved.at),
    offset: officeOffset(resolved.at),
    at: resolved.at,
    shifted: resolved.shifted,
  };
}

function runDate(rotation: RotationRow, index: number): OfficeDate {
  return addOfficeDays(rotation.first_run_on, index * rotation.interval_days);
}

function firstIndexOnOrAfter(rotation: RotationRow, date: OfficeDate): number {
  const gap = daysBetween(rotation.first_run_on, date);
  if (gap <= 0) return 0;
  return Math.floor(gap / rotation.interval_days);
}

export function nextRunAfter(rotation: RotationRow, at: Date): Run | null {
  let index = firstIndexOnOrAfter(rotation, officeDate(at));
  for (let step = 0; step < 400; step += 1) {
    const run = runOn(rotation, runDate(rotation, index + step));
    if (run.at.getTime() > at.getTime()) return run;
  }
  return null;
}

export function nextRuns(rotation: RotationRow, at: Date, count: number): Run[] {
  const runs: Run[] = [];
  let index = firstIndexOnOrAfter(rotation, officeDate(at));
  for (let step = 0; runs.length < count && step < 1_000; step += 1) {
    const run = runOn(rotation, runDate(rotation, index + step));
    if (run.at.getTime() > at.getTime()) runs.push(run);
  }
  return runs;
}

export function runsInMonth(rotation: RotationRow, month: string): Run[] {
  const first = `${month}-01`;
  const last = addOfficeDays(`${addOfficeDays(first, 31).slice(0, 7)}-01`, -1);
  const runs: Run[] = [];
  let index = firstIndexOnOrAfter(rotation, first);
  if (index > 0) index -= 1;
  for (let step = 0; step < 400; step += 1) {
    const date = runDate(rotation, index + step);
    if (date > last) break;
    if (date >= first) runs.push(runOn(rotation, date));
  }
  return runs;
}

/** A turn is due by the second office business day after the office date that caused it. */
export function dueByAfter(date: OfficeDate): OfficeDate {
  return officeBusinessDaysAfter(date, 2);
}

/** A due turn becomes overdue at the office midnight after its due-by date. */
export function overdueFrom(dueBy: OfficeDate): OfficeDate {
  return addOfficeDays(dueBy, 1);
}

export type TurnsDue = { credential_id: string; label: string; due_by: OfficeDate };

export async function createScopeLossTurns(
  client: PoolClient,
  write: AuditWriter,
  options: {
    vaultIds: readonly string[];
    at: Date;
    actor: { personId: string; name: string } | 'Lockset';
    confirmedBy: string | null;
  },
): Promise<TurnsDue[]> {
  if (options.vaultIds.length === 0) return [];
  const dueBy = dueByAfter(officeDate(options.at));
  const rows = await client.query<{ id: string; label: string }>(
    'select id, label from credentials where vault_id = any($1::uuid[]) order by order_no asc',
    [[...options.vaultIds]],
  );
  const created: TurnsDue[] = [];
  for (const credential of rows.rows) {
    await client.query(
      `insert into turns (id, credential_id, rotation_id, kind, run_at, run_office_date, due_by, state)
       values ($1,$2,null,'scope_loss',null,null,$3,'due')`,
      [newId(), credential.id, dueBy],
    );
    created.push({ credential_id: credential.id, label: credential.label, due_by: dueBy });
    await write({
      actor: options.actor,
      action: 'turn_due',
      subject: { kind: 'credential', id: credential.id, name: credential.label },
      details: options.confirmedBy === null ? { due_by: dueBy } : { due_by: dueBy, confirmed_by: options.confirmedBy },
    });
  }
  return created;
}
