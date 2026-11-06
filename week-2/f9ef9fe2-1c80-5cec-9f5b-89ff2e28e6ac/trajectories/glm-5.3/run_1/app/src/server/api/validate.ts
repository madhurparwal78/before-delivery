import { addDays, isValidDate, isValidWallTime, timeHourMinutes } from "../kitchenTime";
import { type Cell, type Station } from "../domain";
import { cellInPast, complianceBlocked, sameDayClosed, validation, type FieldErrors } from "../errors";
import type { KitchenRow } from "../store";
import { kitchenDate, kitchenTime } from "../kitchenTime";

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw validation({ [field]: `Choose a ${field}.` });
  }
  return value;
}

export function parseDate(value: unknown, field: string): string {
  const date = requireString(value, field);
  if (!isValidDate(date)) {
    throw validation({ [field]: "Enter a date as YYYY-MM-DD." });
  }
  return date;
}

/** Dates from today through 365 days after today are open. */
export function checkHorizon(date: string, today: string, field: string): void {
  if (date < today || date > addDays(today, 365)) {
    throw validation({ [field]: "That date is outside the booking horizon." });
  }
}

export function parseWallTime(value: unknown, field: string): string {
  const time = requireString(value, field);
  if (!isValidWallTime(time)) {
    throw validation({ [field]: "Enter a time on a quarter hour." });
  }
  return time;
}

export interface ParsedCells {
  cells: Cell[];
  startQs: number[];
}

export function parseCells(raw: unknown, stations: Station[], field: string): ParsedCells {
  if (!Array.isArray(raw)) {
    throw validation({ [field]: "Choose some cells." });
  }
  const byId = new Map(stations.map((station) => [station.id, station]));
  const seen = new Set<string>();
  const cells: Cell[] = [];
  const startQs: number[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      throw validation({ [field]: "Each cell needs a station and a start." });
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.station_id !== "string" || typeof record.start !== "string") {
      throw validation({ [field]: "Each cell needs a station and a start." });
    }
    const station = byId.get(record.station_id);
    if (!station) {
      throw validation({ [field]: "Those stations are not in this kitchen." });
    }
    const start = record.start;
    if (!isValidWallTime(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) {
      throw validation({ [field]: "Cells run from 04:00 to 23:45 on quarter hours." });
    }
    const minutes = timeHourMinutes(start);
    if (minutes < 240 || minutes > 1425 || minutes % 15 !== 0) {
      throw validation({ [field]: "Cells run from 04:00 to 23:45 on quarter hours." });
    }
    const key = `${record.station_id}|${start}`;
    if (seen.has(key)) {
      throw validation({ [field]: "Each cell may be chosen once." });
    }
    seen.add(key);
    cells.push({ station_id: record.station_id, start });
    startQs.push((minutes - 240) / 15);
  }
  if (cells.length < 1 || cells.length > 320) {
    throw validation({ [field]: "A booking needs 1 to 320 cells." });
  }
  return { cells, startQs };
}

/** Same-day cutoff and past-cell guards, judged in kitchen time. */
export function checkCellGuards(kitchen: KitchenRow, date: string, startQs: number[], now: Date): void {
  const today = kitchenDate(now, kitchen.timezone);
  const nowMinutes = timeHourMinutes(kitchenTime(now, kitchen.timezone));
  if (date === today) {
    const cutoffMinutes = timeHourMinutes(kitchen.same_day_cutoff);
    if (nowMinutes >= cutoffMinutes) {
      throw sameDayClosed();
    }
    const firstCell = Math.min(...startQs);
    if (240 + firstCell * 15 <= nowMinutes) {
      throw cellInPast();
    }
  }
}

export function checkCovered(coveredUntil: string | null, date: string): void {
  if (coveredUntil === null || date > coveredUntil) {
    throw complianceBlocked();
  }
}

export function checkIdempotencyKey(header: string | undefined): string {
  if (header === undefined || !/^[\x20-\x7e]{1,100}$/.test(header)) {
    throw validation({ "Idempotency-Key": "Send an idempotency key of 1 to 100 printable characters." });
  }
  return header;
}

export function monthValue(raw: string | undefined): string {
  if (raw === undefined || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    const errors: FieldErrors = { month: "Choose a month as YYYY-MM." };
    throw validation(errors);
  }
  return raw;
}

export function weekdayValue(raw: unknown): number {
  const day = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw validation({ first_date: "Enter a date as YYYY-MM-DD." });
  }
  return day;
}

export function weeksValue(raw: unknown): number {
  const weeks = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(weeks) || weeks < 2 || weeks > 12) {
    throw validation({ weeks: "Choose 2 to 12 weeks." });
  }
  return weeks;
}

export function wallRange(start: unknown, end: unknown): { start: string; end: string } {
  const startValue = requireString(start, "start");
  const endValue = requireString(end, "end");
  const startOk = isValidWallTime(startValue) && timeHourMinutes(startValue) % 15 === 0 && timeHourMinutes(startValue) >= 240;
  const endOk =
    (isValidWallTime(endValue) && timeHourMinutes(endValue) % 15 === 0 && timeHourMinutes(endValue) > timeHourMinutes(startValue)) || endValue === "24:00";
  if (!startOk) {
    throw validation({ start: "Enter a time on a quarter hour from 04:00." });
  }
  if (!endOk) {
    throw validation({ end: "The end must be after the start, on a quarter hour, up to 24:00." });
  }
  if (timeHourMinutes(endValue) > 1440 || timeHourMinutes(startValue) > 1425) {
    throw validation({ start: "Cells run from 04:00 to 24:00." });
  }
  return { start: startValue, end: endValue };
}

export function cellsForRange(stationIds: string[], start: string, end: string): Cell[] {
  const first = timeHourMinutes(start) / 15;
  const last = end === "24:00" ? 96 : timeHourMinutes(end) / 15;
  const cells: Cell[] = [];
  for (const stationId of stationIds) {
    for (let q = first; q < last; q++) {
      const minutes = q * 15;
      cells.push({ station_id: stationId, start: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}` });
    }
  }
  return cells;
}

