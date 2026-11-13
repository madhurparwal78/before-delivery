import { displayBusinessDate, londonOffsetMs, offsetLabel, pad2, wallClockToInstantMs } from '../../shared/london.js';

export const DATE_TIME_FORMAT_MESSAGE = 'Enter a date and time like 2026-12-01 10:00.';

export type WallClockReading =
  | { kind: 'ok'; timestamp: string }
  | { kind: 'invalid'; message: string };

const TYPED = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/**
 * Reads `YYYY-MM-DD HH:MM` as a London wall-clock time and writes it with London's offset
 * for that date. A time that does not exist in London is refused here, before anything is
 * sent.
 */
export function readLondonWallClock(text: string): WallClockReading {
  const match = TYPED.exec(text.trim());
  if (!match) return { kind: 'invalid', message: DATE_TIME_FORMAT_MESSAGE };
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const real = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    real.getUTCFullYear() !== year ||
    real.getUTCMonth() !== month - 1 ||
    real.getUTCDate() !== day
  ) {
    return { kind: 'invalid', message: DATE_TIME_FORMAT_MESSAGE };
  }

  const instant = wallClockToInstantMs({ year, month, day, hour, minute });
  if (instant === null) {
    const date = displayBusinessDate(`${year}-${pad2(month)}-${pad2(day)}`);
    return {
      kind: 'invalid',
      message: `There is no ${pad2(hour)}:${pad2(minute)} on ${date} in London time.`,
    };
  }
  return {
    kind: 'ok',
    timestamp: `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00${offsetLabel(
      londonOffsetMs(instant),
    )}`,
  };
}
