/** The only module that formats times, counts and plurals for display. */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const clockFormats = new Map<string, Intl.DateTimeFormat>();
const offsetFormats = new Map<string, Intl.DateTimeFormat>();

function cached(store: Map<string, Intl.DateTimeFormat>, zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  let format = store.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone });
    store.set(zone, format);
  }
  return format;
}

/** `Mar 1, 2027` in the configured zone. */
export function formatDate(instant: string | number, zone: string): string {
  const parts = cached(dateFormats, zone, { month: 'short', day: 'numeric', year: 'numeric' }).formatToParts(new Date(instant));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('month')} ${part('day')}, ${part('year')}`;
}

/** `3:05 PM`: the instant floored to the minute on a 12-hour clock, one ASCII space before AM or PM. */
export function formatTime(instant: string | number, zone: string): string {
  const parts = cached(clockFormats, zone, { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).formatToParts(new Date(instant));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`;
}

/** The published relative-time ladder; every division rounds down. */
export function relativeTime(instant: string, nowMs: number, zone: string): string {
  const created = new Date(instant).getTime();
  const elapsed = Math.max(0, Math.floor((nowMs - created) / 1000));
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < 28 * DAY) return `${Math.floor(elapsed / (7 * DAY))}w`;
  return formatDate(created, zone);
}

/** Offset of a zone from UTC at an instant, in milliseconds. */
function zoneOffset(instant: number, zone: string): number {
  const parts = cached(offsetFormats, zone, {
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(instant / 1000) * 1000;
}

const CLOSES = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** Reads `YYYY-MM-DD HH:MM` (24-hour) in the configured zone and returns the UTC instant, or null when it does not match. */
export function zonedTextToInstant(text: string, zone: string): string | null {
  const match = CLOSES.exec(text.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute);
  const probe = local - zoneOffset(local, zone);
  const instant = local - zoneOffset(probe, zone);
  const parts = new Date(instant + zoneOffset(instant, zone));
  if (parts.getUTCDate() !== day || parts.getUTCMonth() !== month - 1) return null;
  return new Date(instant).toISOString();
}

/** The reverse of `zonedTextToInstant`: `YYYY-MM-DD HH:MM` in the configured zone. */
export function instantToZonedText(instant: string, zone: string): string {
  const at = new Date(instant).getTime();
  const shifted = new Date(at + zoneOffset(at, zone)).toISOString();
  return `${shifted.slice(0, 10)} ${shifted.slice(11, 16)}`;
}

export const formatCount = (n: number): string => n.toLocaleString('en-US');

/** `1 comment`, `2 comments`. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${formatCount(n)} ${n === 1 ? one : many}`;

export const countCodePoints = (text: string): number => [...text].length;

/** The first `limit` code points of the text. */
export const takeCodePoints = (text: string, limit: number): string => [...text].slice(0, limit).join('');

export const firstName = (name: string): string => name.split(' ')[0] ?? name;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Apr 2019` for a `YYYY-MM` month on a profile's experience or education. */
export function formatMonth(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTH_NAMES[Number(number) - 1] ?? ''} ${year}`;
}
