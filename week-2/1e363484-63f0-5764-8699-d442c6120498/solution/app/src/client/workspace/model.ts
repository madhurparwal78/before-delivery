// Workspace state: the date window, the brush and the sensor set, their canonical address, and the
// clamped brush moves. Times are whole epoch seconds.

import { DAY, dayOf, epochOf, HALF_HOUR, parseDay, parseStamp, stamp } from "../format";
import type { Project } from "../types";

export interface Range {
  start: number;
  end: number;
}

export interface WorkspaceState {
  /** First and last UTC day of the window (00:00 of each), inclusive. */
  from: number;
  to: number;
  brush: Range;
  sensors: string[];
}

export function recordOf(project: Project): Range | null {
  return project.record_start && project.record_end
    ? { start: epochOf(project.record_start), end: epochOf(project.record_end) }
    : null;
}

const dayStart = (epoch: number) => epoch - (epoch % DAY);

/** The window's span of time, From 00:00 through the end of To, inside the record. */
export function windowRange(from: number, to: number, record: Range): Range {
  return { start: Math.max(from, record.start), end: Math.min(to + DAY, record.end) };
}

export function recordDays(record: Range): { first: number; last: number } {
  return { first: dayStart(record.start), last: dayStart(record.end - 1) };
}

export const sortedIds = (ids: string[]) => [...ids].sort();

/** Restores a state from the address in three steps: window, brush, sensors; each falls back on its own. */
export function stateFromQuery(search: string, project: Project, record: Range): WorkspaceState {
  const query = new URLSearchParams(search);
  const { first, last } = recordDays(record);

  let from = parseDay(query.get("from"));
  let to = parseDay(query.get("to"));
  if (from === null || to === null || from < first || to > last || from > to) {
    from = first;
    to = last;
  }

  const range = windowRange(from, to, record);
  const start = parseStamp(query.get("start"));
  const end = parseStamp(query.get("end"));
  const brushValid = start !== null && end !== null && start % HALF_HOUR === 0 && end % HALF_HOUR === 0 &&
    start >= range.start && end <= range.end && start < end;
  const brush = brushValid ? { start, end } : { ...range };

  const known = project.sensors.map((s) => s.id);
  const listed = (query.get("sensors") ?? "").split(",");
  const sensorsValid = query.get("sensors") && new Set(listed).size === listed.length && listed.every((id) => known.includes(id));
  return { from, to, brush, sensors: sortedIds(sensorsValid ? listed : known) };
}

export function canonicalQuery(state: WorkspaceState): string {
  return `from=${dayOf(state.from)}&to=${dayOf(state.to)}&start=${stamp(state.brush.start)}&end=${stamp(state.brush.end)}&sensors=${sortedIds(state.sensors).join(",")}`;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

export type BrushPart = "start" | "end" | "body";

/** Moves one part of the brush by `delta` seconds, clamped to the window; span stays at least a half-hour. */
export function moveBrush(brush: Range, part: BrushPart, delta: number, range: Range): Range {
  if (part === "start") return { start: clamp(brush.start + delta, range.start, brush.end - HALF_HOUR), end: brush.end };
  if (part === "end") return { start: brush.start, end: clamp(brush.end + delta, brush.start + HALF_HOUR, range.end) };
  const span = brush.end - brush.start;
  const start = clamp(brush.start + delta, range.start, range.end - span);
  return { start, end: start + span };
}

/** The keyboard step for a key on one part of the brush, in seconds; null for other keys. */
export function keyDelta(key: string, part: BrushPart, brush: Range, range: Range): number | null {
  const edge = part === "end" ? brush.end : brush.start;
  switch (key) {
    case "ArrowLeft": case "ArrowDown": return -HALF_HOUR;
    case "ArrowRight": case "ArrowUp": return HALF_HOUR;
    case "PageDown": return -DAY;
    case "PageUp": return DAY;
    case "Home": return range.start - edge;
    case "End": return range.end - (part === "body" ? brush.end : edge);
    default: return null;
  }
}

/** Rounds a drag distance in seconds to whole half-hours. */
export function wholeHalfHours(seconds: number): number {
  return Math.round(seconds / HALF_HOUR) * HALF_HOUR;
}
