import { BOOKING_HORIZON_DAYS, MINIMUM_BOOKING_MINUTES, shapeSentence } from '../../shared/copy';
import { daysBetween } from '../../shared/format';
import {
  closingMinutes,
  kitchenDate,
  kitchenMinutesOfDay,
  kitchenSeconds,
  openingMinutes,
} from '../kitchen-time';
import type { SpanStatus, StationKind } from '../../shared/types';

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** The one rule deciding whether a span on a kitchen date can still be booked. */
export function spanStatusFor(start: Date, now: Date): SpanStatus {
  if (start.getTime() <= now.getTime()) return 'started';
  const daysAhead = daysBetween(kitchenDate(now), kitchenDate(start));
  if (daysAhead > BOOKING_HORIZON_DAYS) return 'beyond_horizon';
  return 'open';
}

export interface ShapeStation {
  id: string;
  kind: StationKind;
}

export interface ShapeInput {
  stationId: unknown;
  shelfId: unknown;
  start: unknown;
  end: unknown;
}

export interface MoveComparison {
  stationId: string;
  shelfId: string | null;
  start: Date;
  end: Date;
}

export interface ShapeResult {
  fields: Record<string, string>;
  station: ShapeStation | null;
  shelf: ShapeStation | null;
  start: Date | null;
  end: Date | null;
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

function onHalfHour(at: Date): boolean {
  return kitchenMinutesOfDay(at) % 30 === 0 && kitchenSeconds(at) === 0;
}

/** Booking shape rules, in order; each field reports the first rule it breaks. */
export function checkBookingShape(
  input: ShapeInput,
  stations: ReadonlyMap<string, ShapeStation>,
  now: Date,
  move: MoveComparison | null,
): ShapeResult {
  const fields: Record<string, string> = {};
  const station = typeof input.stationId === 'string' ? stations.get(input.stationId) ?? null : null;
  if (station === null) fields.stationId = shapeSentence.station;

  const shelfGiven = input.shelfId !== undefined && input.shelfId !== null;
  let shelf: ShapeStation | null = null;
  if (shelfGiven) {
    shelf = typeof input.shelfId === 'string' ? stations.get(input.shelfId) ?? null : null;
    const shelfIsCooler = shelf !== null && shelf.kind === 'cooler_shelf';
    const stationIsCooler = station !== null && station.kind === 'cooler_shelf';
    if (!shelfIsCooler || stationIsCooler) {
      fields.shelfId = shapeSentence.shelf;
      shelf = null;
    }
  }

  const start = parseInstant(input.start);
  const end = parseInstant(input.end);
  if (start === null) fields.start = shapeSentence.isoTime;
  if (end === null) fields.end = shapeSentence.isoTime;

  if (start !== null && !onHalfHour(start)) fields.start ??= shapeSentence.halfHour;
  if (end !== null && !onHalfHour(end)) fields.end ??= shapeSentence.halfHour;

  if (start !== null && end !== null && end.getTime() - start.getTime() < MINIMUM_BOOKING_MINUTES * 60000) {
    fields.end ??= shapeSentence.minimumLength;
  }

  if (start !== null) {
    const minutes = kitchenMinutesOfDay(start);
    if (minutes < openingMinutes || minutes >= closingMinutes) {
      fields.start ??= shapeSentence.operatingHours;
    }
  }
  if (end !== null) {
    const sameDate = start === null || kitchenDate(end) === kitchenDate(start);
    const minutes = kitchenMinutesOfDay(end);
    if (!sameDate || minutes > closingMinutes) {
      fields.end ??= shapeSentence.operatingHours;
    }
  }

  if (start !== null && fields.start === undefined) {
    const status = spanStatusFor(start, now);
    if (status === 'started') fields.start = shapeSentence.started;
    else if (status === 'beyond_horizon') fields.start = shapeSentence.horizon;
  }

  if (
    move !== null &&
    fields.start === undefined &&
    station !== null &&
    start !== null &&
    end !== null &&
    station.id === move.stationId &&
    (shelf?.id ?? null) === move.shelfId &&
    start.getTime() === move.start.getTime() &&
    end.getTime() === move.end.getTime()
  ) {
    fields.start = shapeSentence.sameSpan;
  }

  return { fields, station, shelf, start, end };
}
