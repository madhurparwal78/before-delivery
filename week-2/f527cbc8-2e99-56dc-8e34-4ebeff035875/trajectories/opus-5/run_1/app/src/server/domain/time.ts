/**
 * Practice time. A barn day stores a business date and a start time as wall-clock
 * readings in the practice zone; this module is the only place that turns those into
 * instants, and the only place the cancellation cutoff is derived.
 */

const CUTOFF_LEAD_MS = 24 * 60 * 60 * 1000;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, found);
  }
  return found;
}

/** The wall-clock reading of an instant in a zone. */
export function wallClockAt(instant: Date, zone: string): WallClock {
  const parts = formatter(zone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (part === undefined) throw new Error(`zone ${zone} gave no ${type}`);
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** The zone's offset from UTC in milliseconds at an instant (east of UTC is positive). */
export function offsetMsAt(instant: Date, zone: string): number {
  const wall = wallClockAt(instant, zone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - instant.getTime();
}

export type WallClockResolution =
  | { kind: 'ok'; instant: Date; ambiguous: boolean }
  | { kind: 'nonexistent' };

/**
 * The instant at which the zone's clock reads the given wall clock. A reading the
 * clocks jump over does not exist; a reading they fall back over means its earlier
 * occurrence.
 */
export function resolveWallClock(wall: WallClock, zone: string): WallClockResolution {
  const wantedAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const probes = [
    offsetMsAt(new Date(wantedAsUtc - 86400000), zone),
    offsetMsAt(new Date(wantedAsUtc), zone),
    offsetMsAt(new Date(wantedAsUtc + 86400000), zone),
  ];
  const valid: number[] = [];
  for (const offset of probes) {
    const candidate = wantedAsUtc - offset;
    if (valid.includes(candidate)) continue;
    if (offsetMsAt(new Date(candidate), zone) === wantedAsUtc - candidate) valid.push(candidate);
  }
  if (valid.length === 0) return { kind: 'nonexistent' };
  const earliest = Math.min(...valid);
  return { kind: 'ok', instant: new Date(earliest), ambiguous: valid.length > 1 };
}

export function parseBusinessDate(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function parseStartTime(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** The instant a barn day starts, or nothing when that reading does not exist. */
export function startsAt(businessDate: string, startTime: string, zone: string): Date | null {
  const date = parseBusinessDate(businessDate);
  const time = parseStartTime(startTime);
  if (date === null || time === null) return null;
  const resolved = resolveWallClock(
    { year: date.year, month: date.month, day: date.day, hour: time.hour, minute: time.minute, second: 0 },
    zone,
  );
  return resolved.kind === 'ok' ? resolved.instant : null;
}

/** Exactly 24 elapsed hours before the start, whatever the clocks do in between. */
export function cancellationCutoffAt(start: Date): Date {
  return new Date(start.getTime() - CUTOFF_LEAD_MS);
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0');
}

function offsetLabel(offsetMs: number): string {
  const minutes = Math.round(offsetMs / 60000);
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${pad(Math.trunc(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** `YYYY-MM-DDTHH:MM:SS±HH:MM`, carrying the practice-zone offset in force at the instant. */
export function formatInstant(instant: Date, zone: string): string {
  const wall = wallClockAt(instant, zone);
  const offset = offsetMsAt(instant, zone);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}` +
    `T${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}${offsetLabel(offset)}`
  );
}

/** The business date of an instant in the practice zone. */
export function businessDateAt(instant: Date, zone: string): string {
  const wall = wallClockAt(instant, zone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** `HH:MM` wall-clock reading in the practice zone. */
export function wallTimeAt(instant: Date, zone: string): string {
  const wall = wallClockAt(instant, zone);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** `HH:MM:SS` wall-clock reading in the practice zone. */
export function wallTimeSecondsAt(instant: Date, zone: string): string {
  const wall = wallClockAt(instant, zone);
  return `${pad(wall.hour)}:${pad(wall.minute)}:${pad(wall.second)}`;
}

export function monthAt(instant: Date, zone: string): string {
  const wall = wallClockAt(instant, zone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}`;
}

export function addDays(businessDate: string, days: number): string {
  const date = parseBusinessDate(businessDate);
  if (date === null) throw new Error(`bad business date ${businessDate}`);
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * 86400000);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function compareBusinessDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Slot times run from the start in whole slot-minute steps, read in the practice zone. */
export function slotTimes(start: Date, slotCount: number, slotMinutes: number, zone: string): string[] {
  const times: string[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    times.push(wallTimeAt(new Date(start.getTime() + index * slotMinutes * 60000), zone));
  }
  return times;
}
