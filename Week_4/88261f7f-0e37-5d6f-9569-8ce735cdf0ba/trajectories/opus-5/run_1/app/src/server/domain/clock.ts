import { addDays, PlainDate } from '../../shared/dates';

/** The local hour at which one night ends and the next business day begins. */
const BUSINESS_DAY_HOUR = 4;

/** The local hour, exclusive, at which free cancellation ends on the date before arrival. */
const FREE_CANCELLATION_HOUR = 18;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export interface WallTime {
  date: PlainDate;
  hour: number;
  minute: number;
  second: number;
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The hotel's wall clock reading at an instant. */
function wallTimeAt(timeZone: string, instant: Date): WallTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  const year = String(read('year')).padStart(4, '0');
  const month = String(read('month')).padStart(2, '0');
  const day = String(read('day')).padStart(2, '0');
  return {
    date: `${year}-${month}-${day}`,
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

function wallAsUtcMs(wall: WallTime): number {
  return (
    Date.UTC(
      Number(wall.date.slice(0, 4)),
      Number(wall.date.slice(5, 7)) - 1,
      Number(wall.date.slice(8, 10)),
      wall.hour,
      wall.minute,
      wall.second,
    )
  );
}

function offsetMsAt(timeZone: string, instantMs: number): number {
  return wallAsUtcMs(wallTimeAt(timeZone, new Date(instantMs))) - instantMs;
}

/** The instant at which the hotel's wall clock reads the given local time. */
function instantAtWallTime(timeZone: string, wall: WallTime): Date {
  const target = wallAsUtcMs(wall);
  const firstGuess = target - offsetMsAt(timeZone, target);
  const offset = offsetMsAt(timeZone, firstGuess);
  const secondGuess = target - offset;
  if (offsetMsAt(timeZone, secondGuess) === offset) return new Date(secondGuess);
  return new Date(firstGuess);
}

/**
 * The night an instant belongs to: the local date when the local time is at or after 04:00,
 * otherwise the previous date.
 */
export function nightOf(timeZone: string, instant: Date): PlainDate {
  const wall = wallTimeAt(timeZone, instant);
  return wall.hour >= BUSINESS_DAY_HOUR ? wall.date : addDays(wall.date, -1);
}

/** The instant free cancellation ends for an arrival: 18:00:00 local on the date before it. */
export function freeCancellationDeadline(timeZone: string, arrival: PlainDate): Date {
  return instantAtWallTime(timeZone, {
    date: addDays(arrival, -1),
    hour: FREE_CANCELLATION_HOUR,
    minute: 0,
    second: 0,
  });
}
