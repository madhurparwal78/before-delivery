/** The shop clock and Amsterdam business time. Every business time rule reads this module. */
import { config } from './config.js';

const startReal = Date.now();
const startShop = config.shopClockStart ? Date.parse(config.shopClockStart) : startReal;

/** Milliseconds since the epoch on the shop clock. */
export function shopNowMs(): number {
  return startShop + (Date.now() - startReal) * config.shopClockRate;
}

export function shopNow(): Date {
  return new Date(shopNowMs());
}

const ZONE = 'Europe/Amsterdam';
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function amsterdamParts(ms: number): LocalParts {
  const out: Record<string, number> = {};
  for (const part of parts.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return { year: out['year'] ?? 0, month: out['month'] ?? 0, day: out['day'] ?? 0, hour: out['hour'] ?? 0, minute: out['minute'] ?? 0, second: out['second'] ?? 0 };
}

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

/** `YYYY-MM-DD` of an instant in Amsterdam. */
export function amsterdamDate(ms: number): string {
  const p = amsterdamParts(ms);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

export function amsterdamToday(): string {
  return amsterdamDate(shopNowMs());
}

/** Offset in minutes (60 or 120) of Amsterdam at an instant. */
function amsterdamOffsetMinutes(ms: number): number {
  const p = amsterdamParts(ms);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000);
}

function offsetText(minutes: number): string {
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** The instants an Amsterdam wall-clock reading denotes: none (skipped hour), one, or two (repeated hour), earliest first. */
export function localInstants(date: string, time: string): number[] {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  const found = new Set<number>();
  for (const offset of [60, 120]) {
    const instant = wall - offset * 60000;
    const p = amsterdamParts(instant);
    if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi) found.add(instant);
  }
  return [...found].sort((a, b) => a - b);
}

/** ISO text of an instant with its true Amsterdam offset, with the offset in force on that date. */
export function amsterdamIso(ms: number): string {
  const p = amsterdamParts(ms);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offsetText(amsterdamOffsetMinutes(ms))}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The same day of the month `months` later, or the last day of a shorter month. */
export function addMonthsAnchored(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const index = m - 1 + months;
  const year = y + Math.floor(index / 12);
  const month = ((index % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(Math.min(d, last))}`;
}

/** 0 = Sunday. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}
