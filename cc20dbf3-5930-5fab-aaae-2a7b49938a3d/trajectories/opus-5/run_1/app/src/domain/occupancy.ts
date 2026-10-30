/**
 * Occupancy: the one place that decides when a unit is busy, which units are free
 * for a range, and the open day a unit is back.
 */

import { nextOpenDay, type LibraryCalendar, type LocalDate } from './calendar.js';

export type SpanStatus = 'held' | 'out' | 'overdue';

/** An active hold or loan, reduced to the span it occupies on one unit. */
export interface OccupyingSpan {
  readonly recordType: 'hold' | 'loan';
  readonly recordId: string;
  readonly unitId: string;
  readonly laneIndex: number;
  readonly memberId: string;
  readonly memberName: string;
  readonly status: SpanStatus;
  /** The span's own dates, as reported in lanes. */
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  /** The dates the span actually occupies; for an overdue loan this runs to today. */
  readonly occupiedFrom: LocalDate;
  readonly occupiedTo: LocalDate;
}

export function spanBackOn(
  calendar: LibraryCalendar,
  span: OccupyingSpan,
): LocalDate | null {
  if (span.status === 'overdue') return null;
  return nextOpenDay(calendar, span.endDate);
}

function overlaps(
  fromA: LocalDate,
  toA: LocalDate,
  fromB: LocalDate,
  toB: LocalDate,
): boolean {
  return fromA <= toB && fromB <= toA;
}

/** A unit is busy for a range when any active span covers one of the range's dates. */
export function unitIsBusy(
  spans: readonly OccupyingSpan[],
  unitId: string,
  startDate: LocalDate,
  endDate: LocalDate,
): boolean {
  return spans.some(
    (span) =>
      span.unitId === unitId && overlaps(span.occupiedFrom, span.occupiedTo, startDate, endDate),
  );
}

export interface LaneUnit {
  readonly id: string;
  readonly laneIndex: number;
}

export function freeUnits(
  units: readonly LaneUnit[],
  spans: readonly OccupyingSpan[],
  startDate: LocalDate,
  endDate: LocalDate,
): LaneUnit[] {
  return units.filter((unit) => !unitIsBusy(spans, unit.id, startDate, endDate));
}

/** A claim takes the free unit with the lowest lane index for the whole range. */
export function firstFreeUnit(
  units: readonly LaneUnit[],
  spans: readonly OccupyingSpan[],
  startDate: LocalDate,
  endDate: LocalDate,
): LaneUnit | null {
  const free = freeUnits(units, spans, startDate, endDate);
  let lowest: LaneUnit | null = null;
  for (const unit of free) {
    if (lowest === null || unit.laneIndex < lowest.laneIndex) lowest = unit;
  }
  return lowest;
}
