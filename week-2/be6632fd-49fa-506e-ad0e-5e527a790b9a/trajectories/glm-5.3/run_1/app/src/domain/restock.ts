import { DateTimeFormatter, LocalDate, LocalDateTime } from '@js-joda/core';
import '@js-joda/timezone';
import { CPH, parseDate, parseLocalDateTime, zonedAt, formatInZone, zoneOf } from './dates.js';

export interface RestockOccurrence { instant: Date; copenhagenTime: string; }

// A weekly restock series keeps its Copenhagen wall-clock time; an occurrence that
// lands in the spring-forward gap is shifted forward one hour, and a repeated time
// means its first occurrence. Decided here alone.
export function nextRestockInstants(firstRestock: string, count: number, now: Date): Date[] {
  const first = parseLocalDateTime(firstRestock);
  if (!first) return [];
  const out: Date[] = [];
  let candidate = first;
  for (let i = 0; out.length < count && i < count * 7 + 14; i++) {
    const inst = resolveCphLocal(candidate);
    if (inst.getTime() >= now.getTime()) out.push(inst);
    candidate = candidate.plusWeeks(1);
  }
  return out.slice(0, count);
}

function resolveCphLocal(ldt: LocalDateTime): Date {
  const zone = zoneOf(CPH);
  const rules = zone.rules();
  const ldt2 = rules.validOffsets(ldt).length === 0 ? ldt.plusHours(1) : ldt;
  const off = rules.validOffsets(ldt2)[0];
  return new Date(ldt2.atOffset(off).toInstant().toEpochMilli());
}

export function cphWallClock(instant: Date): string {
  return zonedAt(instant, CPH).format(DateTimeFormatter.ofPattern('yyyy-MM-dd HH:mm'));
}

// The single place that decides whether a Copenhagen local date-time sits in the
// spring-forward gap (from 02:00 up to but not including 03:00 on the gap day).
export function isCphGap(ldt: LocalDateTime): boolean {
  return zoneOf(CPH).rules().validOffsets(ldt).length === 0;
}

export function cphGapDate(ldt: LocalDateTime): string {
  return ldt.toLocalDate().toString();
}

export function toLocalDateTime(dateStr: string): LocalDateTime | null {
  return parseLocalDateTime(dateStr);
}

export function todayInCph(now = new Date()): LocalDate {
  const d = cphDateString(now);
  return parseDate(d)!;
}

function cphDateString(now: Date): string {
  return zonedAt(now, CPH).format(DateTimeFormatter.ofPattern('yyyy-MM-dd'));
}

export function cphTomorrow(now = new Date()): string {
  const d = todayInCph(now).plusDays(1);
  return d.toString();
}

export function weekdayOf(dateStr: string): string {
  const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return names[LocalDate.parse(dateStr).dayOfWeek().value() - 1];
}

export function utcInstant(d: Date): string {
  return formatInZone(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}
