import type { NumberFormat, TimeZone } from './types.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Settings {
  number_format: NumberFormat;
  time_zone: TimeZone;
}

export const DEFAULT_SETTINGS: Settings = { number_format: 'en-US', time_zone: 'UTC' };

function groupDigits(digits: string, format: NumberFormat): string {
  if (digits.length <= 3) return digits;
  if (format === 'en-US') {
    let out = '';
    for (let i = digits.length; i > 0; i -= 3) {
      const start = Math.max(0, i - 3);
      out = digits.slice(start, i) + (out === '' ? '' : ',' + out);
    }
    return out;
  }
  const last = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) parts.unshift(rest);
  return [...parts, last].join(',');
}

/** Every number shown to a person, grouped by their number format. */
export function formatNumber(value: number, format: NumberFormat): string {
  const negative = value < 0;
  const absolute = Math.abs(value);
  const text = String(absolute);
  const [whole, fraction] = text.split('.');
  const grouped = groupDigits(whole, format) + (fraction === undefined ? '' : `.${fraction}`);
  return negative ? `-${grouped}` : grouped;
}

/** Mean rounded half up to one decimal, a trailing .0 dropped. */
export function formatAverage(total: number, count: number, format: NumberFormat): string {
  if (count === 0) return formatNumber(0, format);
  const tenths = Math.floor((total * 10) / count + 0.5);
  return formatNumber(tenths / 10, format);
}

interface ZoneParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  abbreviation: string;
}

function zoneParts(at: Date, zone: TimeZone): ZoneParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });
  const parts = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const named = parts.get('timeZoneName') ?? 'UTC';
  const abbreviation =
    zone === 'UTC' ? 'UTC' : zone === 'Asia/Kolkata' ? 'IST' : named.replace('GMT', 'UTC');
  return {
    year: Number(parts.get('year')),
    month: Number(parts.get('month')),
    day: Number(parts.get('day')),
    hour: Number(parts.get('hour')),
    minute: Number(parts.get('minute')),
    abbreviation,
  };
}

/** A shown or emailed instant, in the reader's zone and date style. */
export function formatDate(at: Date | string, settings: Settings): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  const parts = zoneParts(date, settings.time_zone);
  const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  const month = MONTHS[parts.month - 1];
  if (settings.number_format === 'en-IN') {
    return `${parts.day} ${month} ${parts.year} ${time} ${parts.abbreviation}`;
  }
  return `${month} ${parts.day}, ${parts.year} ${time} ${parts.abbreviation}`;
}

export function formatRelative(at: Date | string, now: Date | string): string {
  const then = typeof at === 'string' ? new Date(at) : at;
  const reference = typeof now === 'string' ? new Date(now) : now;
  const seconds = Math.floor((reference.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
