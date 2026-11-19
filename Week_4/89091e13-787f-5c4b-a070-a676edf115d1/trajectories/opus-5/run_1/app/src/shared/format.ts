import { UFERN_PER_FERN } from './fees.js';

/** `3,999.992000` — thousands separators and 6 decimals, without the unit. */
export function formatFern(ufern: bigint): string {
  const negative = ufern < 0n;
  const absolute = negative ? -ufern : ufern;
  const whole = absolute / UFERN_PER_FERN;
  const fraction = absolute % UFERN_PER_FERN;
  const groups = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${groups}.${fraction.toString().padStart(6, '0')}`;
}

/** Exact fraction to a percentage with the given decimals, half away from zero. */
export function formatPercent(numerator: bigint, denominator: bigint, decimals: number): string {
  if (denominator === 0n) return (0).toFixed(decimals);
  const scale = 10n ** BigInt(decimals);
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const scaled = absNumerator * 100n * scale;
  const rounded = (2n * scaled + absDenominator) / (2n * absDenominator);
  const whole = rounded / scale;
  const fraction = rounded % scale;
  const text = decimals === 0 ? `${whole}` : `${whole}.${fraction.toString().padStart(decimals, '0')}`;
  return negative && rounded !== 0n ? `-${text}` : text;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(iso: string, timeZone: string): ZonedParts {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    formatterCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(iso));
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

export function formatDate(iso: string, timeZone: string): string {
  const parts = zonedParts(iso, timeZone);
  return `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}`;
}

export function formatTime(iso: string, timeZone: string): string {
  const parts = zonedParts(iso, timeZone);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/** The calendar date in the given zone, as YYYY-MM-DD. */
export function zonedDateKey(iso: string, timeZone: string): string {
  const parts = zonedParts(iso, timeZone);
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function withThousands(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Truncates an id in the middle: first 8 and last 8 characters. */
export function truncateId(id: string): string {
  if (id.length <= 18) return id;
  return `${id.slice(0, 8)}…${id.slice(-8)}`;
}
