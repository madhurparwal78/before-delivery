export const HALF_HOUR_MS = 30 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses the API timestamp form `YYYY-MM-DDTHH:MM:SSZ`, returning epoch milliseconds. */
export function parseTimestamp(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = TIMESTAMP_PATTERN.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const ms = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (!Number.isFinite(ms)) return null;
  if (formatTimestamp(ms) !== text) return null;
  return ms;
}

export function formatTimestamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** Truncates to whole seconds, as every server-recorded time is. */
export function truncateToSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

export function isHalfHour(ms: number): boolean {
  return ms % HALF_HOUR_MS === 0;
}

export function parseDate(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = DATE_PATTERN.exec(text);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(ms) || formatDate(ms) !== text) return null;
  return ms;
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The canonical readings file stamp `YYYYMMDDHHMM`. */
export function formatCompactStamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

export function halfHourCount(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / HALF_HOUR_MS);
}
