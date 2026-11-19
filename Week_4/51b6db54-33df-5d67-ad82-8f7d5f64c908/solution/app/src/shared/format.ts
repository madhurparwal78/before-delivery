import type { NumberFormat, TimeZone } from './rules';

export interface Locale {
  number_format: NumberFormat;
  time_zone: TimeZone;
}

export const DEFAULT_LOCALE: Locale = { number_format: 'en-US', time_zone: 'UTC' };

/** Groups digits: en-US in threes, en-IN the last three then twos. */
export function formatNumber(value: number, format: NumberFormat): string {
  return new Intl.NumberFormat(format, { maximumFractionDigits: 1 }).format(value);
}

/** `1 pixel`, `2 pixels`, with the count grouped for the reader. */
export function counted(value: number, noun: string, format: NumberFormat, plural = `${noun}s`): string {
  return `${formatNumber(value, format)} ${value === 1 ? noun : plural}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FIXED_ABBREVIATIONS: Record<string, string> = { UTC: 'UTC', 'Asia/Kolkata': 'IST' };

/** `Mar 8, 2027 16:00 UTC` for en-US and `8 Mar 2027 21:30 IST` for en-IN, in the reader's zone. */
export function formatDate(instant: string | number, locale: Locale): string {
  const moment = new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: locale.time_zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(moment);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const abbreviation = FIXED_ABBREVIATIONS[locale.time_zone] ?? part('timeZoneName');
  const clock = `${part('hour')}:${part('minute')} ${abbreviation}`;
  const month = MONTHS[Number(part('month')) - 1] ?? '';
  return locale.number_format === 'en-IN'
    ? `${part('day')} ${month} ${part('year')} ${clock}`
    : `${month} ${part('day')}, ${part('year')} ${clock}`;
}

/** `Total 201 ms · Average 100.5 ms`: the mean rounds half up to one decimal. */
export function durationLine(durations: readonly number[], format: NumberFormat): string {
  const total = durations.reduce((sum, ms) => sum + ms, 0);
  const average = durations.length === 0 ? 0 : Math.floor((total / durations.length) * 10 + 0.5) / 10;
  return `Total ${formatNumber(total, format)} ms · Average ${formatNumber(average, format)} ms`;
}

/** Relative times by the business clock: just now, minutes, hours, days, floored. */
export function relativeTime(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (seconds < 60) return 'just now';
  const unit = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'} ago`;
  if (seconds < 3600) return unit(Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return unit(Math.floor(seconds / 3600), 'hour');
  return unit(Math.floor(seconds / 86400), 'day');
}
