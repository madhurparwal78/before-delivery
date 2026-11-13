import {
  DAY_MS,
  HALF_HOUR_MS,
  MINUTE_MS,
  formatClockTime,
  parseShipDate,
  shipDateOfLocalMs,
} from './time.js';

export type ClockChange = {
  id: string;
  changesAtMs: number;
  oldOffsetMinutes: number;
  newOffsetMinutes: number;
  latitude: number;
  longitude: number;
  fixId: string | null;
};

/** A vessel's timeline of ship-time offsets: its initial offset plus every logged clock change. */
export type VesselClock = {
  initialOffsetMinutes: number;
  changes: ClockChange[];
};

type OffsetSegment = { startMs: number; endMs: number; offsetMinutes: number };

const BEGINNING_OF_TIME = -8_640_000_000_000;
const END_OF_TIME = 8_640_000_000_000;

function segments(clock: VesselClock): OffsetSegment[] {
  const ordered = [...clock.changes].sort((a, b) => a.changesAtMs - b.changesAtMs);
  const result: OffsetSegment[] = [];
  let startMs = BEGINNING_OF_TIME;
  let offsetMinutes = clock.initialOffsetMinutes;
  for (const change of ordered) {
    result.push({ startMs, endMs: change.changesAtMs, offsetMinutes });
    startMs = change.changesAtMs;
    offsetMinutes = change.newOffsetMinutes;
  }
  result.push({ startMs, endMs: END_OF_TIME, offsetMinutes });
  return result;
}

export function offsetAt(clock: VesselClock, ms: number): number {
  let offsetMinutes = clock.initialOffsetMinutes;
  for (const change of [...clock.changes].sort((a, b) => a.changesAtMs - b.changesAtMs)) {
    if (change.changesAtMs <= ms) offsetMinutes = change.newOffsetMinutes;
    else break;
  }
  return offsetMinutes;
}

/** The offset shown by the clock immediately before an instant. */
export function offsetJustBefore(clock: VesselClock, ms: number): number {
  return offsetAt(clock, ms - 1);
}

export function localReadingAt(clock: VesselClock, ms: number): number {
  return ms + offsetAt(clock, ms) * MINUTE_MS;
}

export function shipDateOf(clock: VesselClock, ms: number): string {
  return shipDateOfLocalMs(localReadingAt(clock, ms));
}

/** The first instant whose clock reading is the given local midnight. */
function instantOfLocalMidnight(clock: VesselClock, localMidnightMs: number): number {
  for (const segment of segments(clock)) {
    const instant = localMidnightMs - segment.offsetMinutes * MINUTE_MS;
    if (instant >= segment.startMs && instant < segment.endMs) return instant;
  }
  throw new Error('The vessel clock never reads that midnight');
}

export type ShipDayBounds = {
  shipDate: string;
  startMs: number;
  endMs: number;
  cellCount: number;
  dayHours: number;
};

export function shipDayBounds(clock: VesselClock, shipDate: string): ShipDayBounds {
  const localMidnight = parseShipDate(shipDate);
  if (localMidnight === null) throw new Error(`Not a ship's date: ${shipDate}`);
  const startMs = instantOfLocalMidnight(clock, localMidnight);
  const endMs = instantOfLocalMidnight(clock, localMidnight + DAY_MS);
  const cellCount = Math.round((endMs - startMs) / HALF_HOUR_MS);
  return { shipDate, startMs, endMs, cellCount, dayHours: cellCount / 2 };
}

export type ShipDayCell = { startMs: number; shipTime: string; repeated: boolean };

export function shipDayCells(clock: VesselClock, shipDate: string): ShipDayCell[] {
  const bounds = shipDayBounds(clock, shipDate);
  const seen = new Set<string>();
  const cells: ShipDayCell[] = [];
  for (let ms = bounds.startMs; ms < bounds.endMs; ms += HALF_HOUR_MS) {
    const localMs = localReadingAt(clock, ms);
    const shipTime = formatClockTime(
      new Date(localMs).getUTCHours() * 60 + new Date(localMs).getUTCMinutes(),
    );
    const repeated = seen.has(shipTime);
    seen.add(shipTime);
    cells.push({ startMs: ms, shipTime, repeated });
  }
  return cells;
}

/**
 * The instant a clock reading of HH:MM falls on within a ship's date. A reading a retard makes
 * occur twice resolves to its first or last occurrence; a reading an advance skips resolves to the
 * first instant after the jump.
 */
export function instantOfShipClockTime(
  clock: VesselClock,
  shipDate: string,
  minutesAfterMidnight: number,
  pick: 'first' | 'last',
): number {
  const bounds = shipDayBounds(clock, shipDate);
  const target = minutesAfterMidnight * MINUTE_MS;
  const matches: number[] = [];
  for (let ms = bounds.startMs; ms < bounds.endMs; ms += HALF_HOUR_MS) {
    const localMs = localReadingAt(clock, ms);
    const sinceMidnight = localMs - Math.floor(localMs / DAY_MS) * DAY_MS;
    if (sinceMidnight === target) matches.push(ms);
  }
  if (matches.length > 0) {
    const chosen = pick === 'first' ? matches[0] : matches[matches.length - 1];
    return chosen as number;
  }
  for (let ms = bounds.startMs; ms < bounds.endMs; ms += HALF_HOUR_MS) {
    const localMs = localReadingAt(clock, ms);
    const sinceMidnight = localMs - Math.floor(localMs / DAY_MS) * DAY_MS;
    if (sinceMidnight > target) return ms;
  }
  return bounds.endMs;
}

export function clockChangeKind(change: ClockChange): 'retard' | 'advance' {
  return change.newOffsetMinutes < change.oldOffsetMinutes ? 'retard' : 'advance';
}

/** The fold label for a clock change, as published in Feedback states. */
export function clockChangeLabel(change: ClockChange): string {
  const hours = Math.abs(change.newOffsetMinutes - change.oldOffsetMinutes) / 60;
  const text = Number.isInteger(hours) ? String(hours) : String(hours);
  return `${clockChangeKind(change) === 'retard' ? '+' : '-'}${text} h`;
}

export function nauticalZone(longitude: number): number {
  const raw = longitude / 15;
  return raw >= 0 ? Math.round(raw) : -Math.round(-raw);
}

export function zoneWarning(newOffsetMinutes: number, longitude: number): boolean {
  const zoneHours = nauticalZone(longitude);
  return Math.abs(newOffsetMinutes / 60 - zoneHours) > 1;
}
