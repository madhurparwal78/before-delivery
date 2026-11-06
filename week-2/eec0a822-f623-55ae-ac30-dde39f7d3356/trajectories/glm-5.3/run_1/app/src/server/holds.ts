import type { PoolClient } from 'pg';
import { addDays, diffSeconds, instToIso, type Base } from '../shared/bases.js';
import { stateConflict } from './errors.js';
import type { Hold, Week } from './types.js';
import { add, mul, pow, sub, div, Decimal, roundHalfUp } from '../shared/decimal.js';

export interface HoldRow {
  id: string;
  workspace_slug: string;
  yacht_slug: string;
  week_start: string;
  week_end: string;
  client_name: string;
  placed_by_kind: 'member' | 'broker';
  placed_by_id: string | null;
  placed_by_name: string;
  broker_id: string | null;
  status: 'waiting' | 'live' | 'lapsed' | 'released' | 'charter';
  position: number | null;
  placed_at: Date;
  live_since: Date | null;
  lapses_at: Date | null;
  charter_id: string | null;
  yacht_length_m: string;
  season: 'low' | 'shoulder' | 'high';
  weekly_rate_minor: string;
}

export function holdToApi(r: HoldRow): Hold {
  return {
    id: r.id,
    yachtSlug: r.yacht_slug,
    weekStart: r.week_start,
    weekEnd: r.week_end,
    clientName: r.client_name,
    placedBy: { kind: r.placed_by_kind, name: r.placed_by_name },
    status: r.status,
    position: r.position,
    placedAt: instToIso({ ms: r.placed_at.getTime() }),
    liveSince: r.live_since ? instToIso({ ms: r.live_since.getTime() }) : null,
    lapsesAt: r.lapses_at ? instToIso({ ms: r.lapses_at.getTime() }) : null,
    charterId: r.charter_id,
  };
}

export interface HoldRecord {
  id: string;
  status: string;
  position: number | null;
}

export function holdQuery(where: string): string {
  return `
    SELECT id, workspace_slug, yacht_slug, week_start, week_end, client_name,
           placed_by_kind, placed_by_id, placed_by_name, broker_id, status, position,
           placed_at, live_since, lapses_at, charter_id, yacht_length_m, season, weekly_rate_minor
    FROM holds ${where}`;
}

export function quote(str: string): string {
  return `'${str.replace(/'/g, "''")}'`;
}

export function seasonOf(weekStart: string): 'low' | 'shoulder' | 'high' {
  const month = Number(weekStart.slice(5, 7));
  if (month === 7 || month === 8) return 'high';
  if (month === 5 || month === 6 || month === 9) return 'shoulder';
  return 'low';
}

export function nextSaturdayAfter(base: Base, date: string): string {
  const wd = new Date(date + 'T12:00:00Z').getUTCDay();
  return addDays(date, ((6 - wd + 7) % 7) || 7);
}

export function weeksWindow(base: Base, today: string): string[] {
  const first = nextSaturdayAfter(base, today);
  const out: string[] = [];
  for (let i = 0; i < 26; i++) out.push(addDays(first, i * 7));
  return out;
}

export function weekEnd(weekStart: string): string {
  return addDays(weekStart, 7);
}

export function secondsBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 1000);
}

/** Convert EUR minor to client-currency minor, rounding half up. */
export function convertAmount(eurMinor: string, rate: string): string {
  return roundHalfUp(mul(new Decimal(eurMinor), new Decimal(rate)), 0).toFixed(0);
}

export function cumulativeOnHand(received: number, used: number, spoiled: number): number {
  return received - used - spoiled;
}

export function minutesLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function diffMs(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

export { add, mul, pow, sub, div, Decimal, roundHalfUp };
