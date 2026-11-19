/**
 * The one sales-office time rule, applied by both the server and the browser:
 * short weekday, day without a leading zero, short month, 24-hour time without
 * seconds, then the zone abbreviation. For example `Mon 5 Apr 15:00 AEST`.
 */

const partsFormatter = new Map<string, Intl.DateTimeFormat>();
const offsetFormatter = new Map<string, Intl.DateTimeFormat>();

function partsFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
}

function offsetFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'longOffset' });
    offsetFormatter.set(timeZone, formatter);
  }
  return formatter;
}

/** The zone's offset from UTC at that instant, in minutes. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const name = offsetFor(timeZone)
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName');
  const match = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name ? name.value : 'GMT+00:00');
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
}

export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const minutes = zoneOffsetMinutes(instant, timeZone);
  if (minutes === 660) return 'AEDT';
  if (minutes === 600) return 'AEST';
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const rest = String(absolute % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${rest}`;
}

export function formatSalesOfficeTime(instant: Date | string, timeZone: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Map(partsFor(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = parts.get('weekday') ?? '';
  const day = parts.get('day') ?? '';
  const month = parts.get('month') ?? '';
  const hour = parts.get('hour') ?? '';
  const minute = parts.get('minute') ?? '';
  return `${weekday} ${day} ${month} ${hour}:${minute} ${zoneAbbreviation(date, timeZone)}`;
}

/** `<hours>:<minutes>:<seconds>`, with at least two digits for hours. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
