import type { RotationRow } from "./model.js";
import { addDays, officeDate, officeInstant, officeMoment } from "./office-time.js";

const ROTATION_ROWS_AHEAD = 6;

interface Run {
  k: number;
  office_date: string;
  office_time: string;
  offset: "CST" | "CDT";
  at: Date;
  shifted: boolean;
}

type Schedule = Pick<RotationRow, "interval_days" | "at_time" | "first_run_on">;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A run keeps its office wall-clock time; DST nights follow the office-time rule. */
function runAt(schedule: Schedule, k: number): Run {
  const date = addDays(schedule.first_run_on, k * schedule.interval_days);
  const { at, shifted } = officeInstant(date, schedule.at_time);
  const moment = officeMoment(at);
  return { k, office_date: date, office_time: moment.time, offset: moment.offset, at, shifted };
}

/** Runs whose instant is strictly after `after`, in order. */
export function runsAfter(schedule: Schedule, after: Date, count: number): Run[] {
  const gap = daysBetween(schedule.first_run_on, officeDate(after));
  let k = Math.max(0, Math.floor(gap / schedule.interval_days) - 1);
  const found: Run[] = [];
  while (found.length < count) {
    const run = runAt(schedule, k++);
    if (run.at.getTime() > after.getTime()) found.push(run);
  }
  return found;
}

/** Runs with `after` < instant <= `until`. */
export function runsBetween(schedule: Schedule, after: Date, until: Date): Run[] {
  const gap = daysBetween(schedule.first_run_on, officeDate(after));
  let k = Math.max(0, Math.floor(gap / schedule.interval_days) - 1);
  const found: Run[] = [];
  for (;;) {
    const run = runAt(schedule, k++);
    if (run.at.getTime() > until.getTime()) return found;
    if (run.at.getTime() > after.getTime()) found.push(run);
  }
}

/** Runs whose office date falls in [from, to]. */
export function runsInDates(schedule: Schedule, from: string, to: string): Run[] {
  const gap = daysBetween(schedule.first_run_on, from);
  let k = Math.max(0, Math.floor(gap / schedule.interval_days) - 1);
  const found: Run[] = [];
  for (;;) {
    const run = runAt(schedule, k++);
    if (run.office_date > to) return found;
    if (run.office_date >= from) found.push(run);
  }
}

export function runJson(run: Run): Record<string, unknown> {
  return {
    office_date: run.office_date,
    office_time: run.office_time,
    offset: run.offset,
    at: run.at.toISOString(),
    shifted: run.shifted,
  };
}

export function rotationJson(rotation: RotationRow, at: Date): Record<string, unknown> {
  return {
    id: rotation.id,
    credential_id: rotation.credential_id,
    interval_days: rotation.interval_days,
    at_time: rotation.at_time,
    first_run_on: rotation.first_run_on,
    next_runs: runsAfter(rotation, at, ROTATION_ROWS_AHEAD).map(runJson),
  };
}

