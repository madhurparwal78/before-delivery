import {
  type Cell,
  FIRST_CELL_MINUTES,
  HORIZON_DAYS,
  type Kitchen,
  LAST_CELL_MINUTES,
  MAX_CELLS,
  type Role,
  type Station,
  type User,
} from "./domain.js";
import { refuse } from "./errors.js";
import type { ApiRequest, Handler, Reply } from "./http.js";
import { addDays, isCalendarDate, isQuarterHour, kitchenDate, kitchenMinutes, minutesOf } from "./kitchenTime.js";
import { currentUser } from "./session.js";
import { cellKey } from "./store.js";

// Request reading and the checks shared by quotes, holds and series.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function bodyOf(request: ApiRequest): Record<string, unknown> {
  return isRecord(request.json) ? request.json : {};
}

/** Wraps a handler that needs a signed-in user; `now` is the one server clock reading for the request. */
export function authed(handler: (request: ApiRequest, user: User, now: Date) => Promise<Reply>): Handler {
  return async (request) => {
    const now = new Date();
    const user = await currentUser(request.headers, now);
    return handler(request, user, now);
  };
}

export function allow(user: User, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw refuse.forbidden();
}

export type Errors = Record<string, string>;

export function failIfAny(errors: Errors): void {
  if (Object.keys(errors).length > 0) throw refuse.validation(errors);
}

/** A kitchen date from today through 365 days after today. */
export function readBookableDate(value: unknown, kitchen: Kitchen, now: Date, errors: Errors, field = "date"): string {
  const today = kitchenDate(kitchen.timezone, now);
  if (!isCalendarDate(value) || value < today || value > addDays(today, HORIZON_DAYS)) {
    errors[field] = "Choose a kitchen date from today to 365 days ahead.";
    return "";
  }
  return value;
}

const cellStart = (value: unknown): value is string => isQuarterHour(value, FIRST_CELL_MINUTES, LAST_CELL_MINUTES);

/** 1 to 320 distinct on-grid cells of the kitchen's stations (another kitchen's ids were already not found). */
export function readCells(value: unknown, stations: Station[], errors: Errors): Cell[] {
  const ids = new Set(stations.map((s) => s.id));
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CELLS) {
    errors.cells = `Send 1 to ${MAX_CELLS} cells.`;
    return [];
  }
  const cells: Cell[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.station_id !== "string" || !ids.has(item.station_id) || !cellStart(item.start)) {
      errors.cells = "Every cell needs a station of this kitchen and a quarter-hour start from 04:00 to 23:45.";
      return [];
    }
    const cell = { station_id: item.station_id, start: item.start };
    if (seen.has(cellKey(cell))) {
      errors.cells = "Each cell may appear once.";
      return [];
    }
    seen.add(cellKey(cell));
    cells.push(cell);
  }
  return cells;
}

/** Same-day cutoff, then cells that have already started, both in kitchen time. */
export function checkSameDay(kitchen: Kitchen, date: string, starts: string[], now: Date): void {
  if (date !== kitchenDate(kitchen.timezone, now)) return;
  const nowMinutes = kitchenMinutes(kitchen.timezone, now);
  if (nowMinutes >= minutesOf(kitchen.same_day_cutoff)) throw refuse.sameDayClosed(kitchen.same_day_cutoff);
  if (starts.some((start) => minutesOf(start) <= nowMinutes)) throw refuse.cellInPast();
}

export function readBoolean(value: unknown, field: string, errors: Errors): boolean {
  if (typeof value !== "boolean") {
    errors[field] = "Send true or false.";
    return false;
  }
  return value;
}

export function readWholeCents(value: unknown, field: string, errors: Errors): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    errors[field] = "Send a whole number of cents.";
    return 0;
  }
  return value;
}
