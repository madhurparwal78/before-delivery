import type { Config } from './config.js';

// The one app clock (Business rules: App clock). Every domain decision reads it.
const bootMonotonic = performance.now();
let bootWall: number;

export class AppClock {
  private readonly clockStart: number | null;
  private readonly baseWall: number;

  constructor(clockStart: number | null) {
    this.clockStart = clockStart;
    this.baseWall = Date.now();
    bootWall = this.baseWall;
  }

  now(): number {
    if (this.clockStart === null) return Date.now();
    return this.clockStart + (performance.now() - bootMonotonic);
  }

  nowIso(): string {
    return new Date(this.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  httpDate(): string {
    return new Date(this.now()).toUTCString();
  }
}

export function salesOfficeTime(ms: number, tz: string): string {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: undefined,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string): string => {
    const p = parts.find((x) => x.type === t);
    return p ? p.value : '';
  };
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const offset = zoneOffsetMinutes(d, tz);
  const abbr = offsetAbbr(offset, d, tz);
  return `${get('weekday')} ${get('day')} ${get('month')} ${hour}:${get('minute')} ${abbr}`;
}

function zoneOffsetMinutes(d: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? Number(p.value) : 0;
  };
  const asUTC = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  );
  return Math.round((asUTC - d.getTime()) / 60000);
}

function offsetAbbr(offsetMinutes: number, d: Date, tz: string): string {
  if (offsetMinutes === 660) return 'AEDT';
  if (offsetMinutes === 600) return 'AEST';
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

export function countdownClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function money(n: number): string {
  return n.toLocaleString('en-AU');
}

export const clockFromConfig = (config: Config): AppClock => new AppClock(config.clockStart);
