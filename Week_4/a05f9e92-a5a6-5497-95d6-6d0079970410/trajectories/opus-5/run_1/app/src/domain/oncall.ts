/**
 * Weekly rotations, overrides and the escalation ladder. Handover keeps its
 * wall-clock time across daylight saving changes because each shift start is
 * read as a local time on its own date.
 */

import { addDays, localDate, type LocalDate, wallTimeOn, weekdayIndex } from './zone';

export interface Rotation {
  readonly name: string;
  readonly timeZone: string;
  readonly handoverWeekday: string;
  readonly handoverTime: string;
  readonly members: readonly string[];
  readonly anchorDate: LocalDate;
}

export interface RotationOverride {
  readonly id: number;
  readonly rotation: string;
  readonly username: string;
  readonly start: number;
  readonly end: number;
}

export interface Shift {
  readonly username: string;
  readonly start: number;
  readonly end: number;
  readonly override: boolean;
}

/** The local date the shift with this index starts on. */
function shiftStartDate(rotation: Rotation, index: number): LocalDate {
  return addDays(firstShiftDate(rotation), index * 7);
}

/** The anchor date moved forward to the handover weekday, so shifts land on it. */
function firstShiftDate(rotation: Rotation): LocalDate {
  const wanted = weekdayIndex(rotation.handoverWeekday);
  if (wanted < 0) return rotation.anchorDate;
  const anchor = rotation.anchorDate;
  const { year, month, day } = parse(anchor);
  const have = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(anchor, (wanted - have + 7) % 7);
}

function parse(date: LocalDate): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Not a local date: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function shiftStartInstant(rotation: Rotation, index: number): number {
  return wallTimeOn(rotation.timeZone, shiftStartDate(rotation, index), rotation.handoverTime);
}

/** The shift index covering an instant. */
export function shiftIndexAt(rotation: Rotation, at: number): number {
  const first = shiftStartInstant(rotation, 0);
  let index = Math.floor((at - first) / (7 * 86_400_000));
  for (let guard = 0; guard < 8; guard += 1) {
    const start = shiftStartInstant(rotation, index);
    const end = shiftStartInstant(rotation, index + 1);
    if (at < start) index -= 1;
    else if (at >= end) index += 1;
    else return index;
  }
  return index;
}

export function shiftAt(rotation: Rotation, at: number): Shift {
  const index = shiftIndexAt(rotation, at);
  const members = rotation.members;
  const who = members.length === 0 ? '' : members[((index % members.length) + members.length) % members.length];
  return {
    username: who,
    start: shiftStartInstant(rotation, index),
    end: shiftStartInstant(rotation, index + 1),
    override: false,
  };
}

/** Where overrides overlap, the most recently created one wins. */
export function overrideAt(
  overrides: readonly RotationOverride[],
  rotation: string,
  at: number,
): RotationOverride | null {
  const covering = overrides.filter(
    (o) => o.rotation === rotation && at >= o.start && at < o.end,
  );
  if (covering.length === 0) return null;
  return covering.reduce((latest, o) => (o.id > latest.id ? o : latest));
}

export function onCallAt(
  rotation: Rotation,
  overrides: readonly RotationOverride[],
  at: number,
): Shift {
  const override = overrideAt(overrides, rotation.name, at);
  if (override) {
    return { username: override.username, start: override.start, end: override.end, override: true };
  }
  return shiftAt(rotation, at);
}

/** The shifts touching a range, with overrides cut in. */
export function shiftsBetween(
  rotation: Rotation,
  overrides: readonly RotationOverride[],
  from: number,
  to: number,
): Shift[] {
  const out: Shift[] = [];
  let index = shiftIndexAt(rotation, from);
  for (let guard = 0; guard < 520; guard += 1) {
    const start = shiftStartInstant(rotation, index);
    if (start >= to) break;
    const base = shiftAt(rotation, start);
    const pieces = cutOverrides(base, overrides, rotation.name);
    for (const piece of pieces) {
      if (piece.end > from && piece.start < to) out.push(piece);
    }
    index += 1;
  }
  return out;
}

function cutOverrides(
  base: Shift,
  overrides: readonly RotationOverride[],
  rotation: string,
): Shift[] {
  const covering = overrides
    .filter((o) => o.rotation === rotation && o.end > base.start && o.start < base.end)
    .sort((a, b) => a.start - b.start || b.id - a.id);
  if (covering.length === 0) return [base];
  const out: Shift[] = [];
  let cursor = base.start;
  for (const o of covering) {
    const start = Math.max(o.start, base.start);
    const end = Math.min(o.end, base.end);
    if (start > cursor) out.push({ ...base, start: cursor, end: start });
    if (end > start) out.push({ username: o.username, start, end, override: true });
    cursor = Math.max(cursor, end);
  }
  if (cursor < base.end) out.push({ ...base, start: cursor, end: base.end });
  return out;
}

export interface EscalationLevelSpec {
  readonly target: { readonly rotation?: string; readonly user?: string };
  readonly ackMinutes: number | null;
}

export interface EscalationPolicy {
  readonly name: string;
  readonly levels: readonly EscalationLevelSpec[];
}

export interface PageLevel {
  readonly level: number;
  readonly username: string;
  readonly notifiedAt: number;
  readonly ackDueAt: number;
}

export type PageStatus = 'paging' | 'acknowledged' | 'exhausted';

export function ackDue(level: EscalationLevelSpec, notifiedAt: number, defaultMinutes: number): number {
  const minutes = level.ackMinutes ?? defaultMinutes;
  return notifiedAt + minutes * 60_000;
}

/** The published activity lines for an acknowledge. */
export function acknowledgeLine(displayName: string, level: number): string {
  return `Acknowledged by ${displayName} at level ${level}.`;
}

export function lateAcknowledgeLine(displayName: string, level: number, current: number): string {
  return `Late acknowledge from ${displayName} at level ${level}; paging had reached level ${current}.`;
}

export const dayLocalDate = localDate;
