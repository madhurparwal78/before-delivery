import { roundCents } from './util.js';
import { weekdayOf, wallClockHours, type Weekday } from './time.js';

export interface PeakWindow {
  days: Weekday[];
  start: string;
  end: string;
}

export interface RateVersionRow {
  id: string;
  station_id: string;
  effective_from_local: string;
  effective_at: Date;
  off_peak_cents: number | null;
  peak_cents: number | null;
  shelf_day_cents: number | null;
  created_at: Date;
}

export interface StationRow {
  id: string;
  kitchen_id: string;
  name: string;
  kind: 'hourly' | 'shelf';
  capacity: number | null;
  lane_order: number;
}

/**
 * Peak quarters of an hourly block, judged in kitchen local time.
 * A block's quarter hours count as peak when they fall inside a peak
 * window for that weekday.
 */
export function peakQuarters(localDate: string, localStart: string, localEnd: string, windows: PeakWindow[]): number {
  const weekday = weekdayOf(localDate);
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const startMin = toMin(localStart);
  const endMin = localEnd === '24:00' ? 24 * 60 : toMin(localEnd);
  let peak = 0;
  for (const w of windows) {
    if (!w.days.includes(weekday)) continue;
    const ws = toMin(w.start);
    const we = w.end === '24:00' ? 24 * 60 : toMin(w.end);
    for (let q = startMin; q < endMin; q += 15) {
      if (q >= ws && q < we) peak++;
    }
  }
  return peak;
}

/**
 * A block uses the station's latest rate version whose effective instant is at
 * or before the block's start instant. A block that straddles an effective
 * instant bills wholly at the version in force at its start.
 */
export function rateForBlock(versions: RateVersionRow[], startInstant: Date): RateVersionRow | null {
  let chosen: RateVersionRow | null = null;
  for (const v of versions) {
    if (v.effective_at.getTime() <= startInstant.getTime()) {
      if (!chosen || v.effective_at.getTime() > chosen.effective_at.getTime()) chosen = v;
    }
  }
  return chosen;
}

export interface PriceInput {
  kind: 'hourly' | 'shelf';
  days?: number | null;
  localDate?: string;
  localStart?: string | null;
  localEnd?: string | null;
  version: RateVersionRow | null;
  windows: PeakWindow[];
}

/**
 * Exact block pricing: peak and off-peak quarter hours at the applicable
 * rates, rounded once to the cent, half away from zero. Shelves bill whole
 * days at the shelf-day rate.
 */
export function priceBlock(input: PriceInput): { chargeCents: number; hours: number; peakHours: number } {
  if (input.kind === 'shelf') {
    const days = input.days ?? 1;
    const cents = (input.version?.shelf_day_cents ?? 0) * days;
    return { chargeCents: cents, hours: 0, peakHours: 0 };
  }
  const hours = wallClockHours(input.localStart ?? '00:00', input.localEnd ?? '24:00');
  const quarters = Math.round(hours * 4);
  const peakQ = peakQuarters(input.localDate ?? '', input.localStart ?? '00:00', input.localEnd ?? '24:00', input.windows);
  const offPeakQ = quarters - peakQ;
  const amount =
    (peakQ * (input.version?.peak_cents ?? 0) + offPeakQ * (input.version?.off_peak_cents ?? 0)) / 4;
  return { chargeCents: roundCents(amount), hours, peakHours: peakQ / 4 };
}

export interface RateStatusInput {
  versions: RateVersionRow[];
  now: Date;
}

/** Past, current or scheduled, decided by the server clock at each request. */
export function rateStatus(version: RateVersionRow, versions: RateVersionRow[], now: Date): 'past' | 'current' | 'scheduled' {
  const inForce = [...versions]
    .filter((v) => v.effective_at.getTime() <= now.getTime())
    .sort((a, b) => a.effective_at.getTime() - b.effective_at.getTime());
  const current = inForce.length > 0 ? inForce[inForce.length - 1] : null;
  if (current && current.id === version.id) return 'current';
  if (version.effective_at.getTime() > now.getTime()) return 'scheduled';
  return 'past';
}
