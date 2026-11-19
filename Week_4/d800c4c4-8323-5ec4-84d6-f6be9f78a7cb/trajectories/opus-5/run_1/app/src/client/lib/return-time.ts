import {
  instantsForWallClock,
  offsetMinutesAt,
  parseLibraryDate,
  zoneAbbreviationAt,
} from '../../shared/time';

const RETURN_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/;

export type ReturnTimeReading =
  | { kind: 'empty' }
  | { kind: 'malformed' }
  | { kind: 'skipped' }
  | { kind: 'single'; instants: Date[] }
  | { kind: 'repeated'; instants: Date[]; hour: number; abbreviation: string };

/**
 * Return time is typed as library-local wall-clock text whatever the browser's
 * time zone. This reads it and reports whether that wall-clock time happens
 * once, twice because the clocks go back, or never because they go forward.
 */
export function readReturnTime(text: string, zone: string): ReturnTimeReading {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  const match = RETURN_TIME_PATTERN.exec(trimmed);
  if (!match) return { kind: 'malformed' };
  const [, date, hourText, minuteText] = match;
  if (!date || !hourText || !minuteText || parseLibraryDate(date) === null) {
    return { kind: 'malformed' };
  }
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) return { kind: 'malformed' };
  const instants = instantsForWallClock(date, hour * 3600 + minute * 60, zone);
  if (instants.length === 0) return { kind: 'skipped' };
  if (instants.length === 1) return { kind: 'single', instants };
  const later = instants[instants.length - 1] as Date;
  return { kind: 'repeated', instants, hour, abbreviation: zoneAbbreviationAt(later, zone) };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/** The typed text with the library offset in force at the chosen occurrence. */
export function returnTimeToIso(
  text: string,
  zone: string,
  secondOccurrence: boolean,
): string | null {
  const reading = readReturnTime(text, zone);
  if (reading.kind !== 'single' && reading.kind !== 'repeated') return null;
  const instant =
    secondOccurrence && reading.kind === 'repeated'
      ? (reading.instants[reading.instants.length - 1] as Date)
      : (reading.instants[0] as Date);
  const offset = offsetMinutesAt(instant, zone);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return (
    `${text.trim().replace(' ', 'T')}:00` +
    `${sign}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`
  );
}

export function secondHourLabel(reading: ReturnTimeReading): string | null {
  if (reading.kind !== 'repeated') return null;
  return `Second ${reading.hour} o'clock hour (${reading.abbreviation})`;
}
