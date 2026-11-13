import { KitchenClock, parseIsoTime } from './kitchen.js';

export const OPENS_MIN = 5 * 60;   // 05:00
export const CLOSSES_MIN = 23 * 60; // 23:00
export const MIN_BOOKING_MINUTES = 120;
export const BOOKING_HORIZON_DAYS = 60;
export const CLEANUP_MINUTES = 30;
export const DOOR_OPEN_BEFORE_START_MIN = 30;
export const MAX_NOTE_CHARS = 500;
export const EXPIRY_SOON_DAYS = 7;

export interface StationSeed {
  id: string; name: string; kind: 'range' | 'prep_table' | 'mixer' | 'cooler_shelf';
  cleanupMinutes: number; col: number; row: number;
}

export const PACK_CATALOG: ReadonlyArray<{ hours: 10 | 20 | 40; priceCents: number }> = [
  { hours: 10, priceCents: 26000 },
  { hours: 20, priceCents: 48000 },
  { hours: 40, priceCents: 88000 },
];

export function minutesOfDay(clock: KitchenClock, epochMs: number): number {
  const p = clock.parts(epochMs);
  return p.hour * 60 + p.minute;
}

export type SpanStatus = 'open' | 'started' | 'beyond_horizon';

// One rule decides whether a span can still be booked; floor, claims and moves share it.
export function spanStatus(clock: KitchenClock, now: number, startEpoch: number): SpanStatus {
  if (startEpoch <= now) return 'started';
  const todayKey = clock.dateKey(now);
  const startKey = clock.dateKey(startEpoch);
  if (clock.daysBetweenKeys(todayKey, startKey) > BOOKING_HORIZON_DAYS) return 'beyond_horizon';
  return 'open';
}

export interface ShapeResult {
  fields: { start?: string; end?: string; stationId?: string; shelfId?: string };
  start: number; end: number; stationId: string; shelfId: string | null;
}

export interface ShapeInput {
  clock: KitchenClock; now: number;
  body: Record<string, unknown>;
  stations: Map<string, { id: string; name: string; kind: string }>;
  isMove: boolean;
  current?: { stationId: string; shelfId: string | null; start: number; end: number } | null;
}

export const SHAPE_SENTENCES = {
  stationMissing: 'Pick a station on the floor plan.',
  shelf: 'Pick a walk-in shelf to pair with a range, prep table or mixer.',
  iso: 'Use an ISO 8601 time with a UTC offset.',
  halfHour: 'Use a time on the hour or half hour.',
  length: 'Bookings last at least 2 h.',
  hours: 'Book between 05:00 and 23:00 on one day.',
  started: 'That span has already started. Pick a later span.',
  horizon: 'Bookings open up to 60 days ahead. Pick an earlier date.',
  same: 'Pick a different station or span.',
} as const;

// Booking shape rules, in their published order. Each field carries the sentence
// of the first rule it breaks.
export function validateShape(input: ShapeInput): ShapeResult | { fields: Record<string, string> } {
  const { clock, now, stations, body, isMove } = input;
  const fields: Record<string, string> = {};

  const stationIdRaw = body.stationId;
  let stationId = '';
  if (typeof stationIdRaw !== 'string' || !stations.has(stationIdRaw)) {
    fields.stationId = SHAPE_SENTENCES.stationMissing;
  } else {
    stationId = stationIdRaw;
  }

  let shelfId: string | null = null;
  const shelfRaw = body.shelfId;
  if (shelfRaw !== undefined && shelfRaw !== null) {
    const ok = typeof shelfRaw === 'string';
    const shelf = ok ? stations.get(shelfRaw as string) : undefined;
    const station = stationId ? stations.get(stationId) : undefined;
    const shelfOk = shelf !== undefined && shelf.kind === 'cooler_shelf'
      && station !== undefined && station.kind !== 'cooler_shelf';
    if (!shelfOk) {
      fields.shelfId = SHAPE_SENTENCES.shelf;
    } else {
      shelfId = shelfRaw as string;
    }
  }

  const startMs = parseIsoTime(body.start);
  const endMs = parseIsoTime(body.end);
  if (startMs === null) fields.start = SHAPE_SENTENCES.iso;
  if (endMs === null) {
    if (!fields.start) fields.end = SHAPE_SENTENCES.iso;
    else fields.end = SHAPE_SENTENCES.iso;
  }

  let start = 0; let end = 0;
  if (startMs !== null && endMs !== null) {
    start = startMs; end = endMs;
    for (const [name, ms] of [['start', startMs], ['end', endMs]] as const) {
      const p = clock.parts(ms);
      if (p.second !== 0 || p.minute % 30 !== 0) {
        fields[name] = fields[name] ?? SHAPE_SENTENCES.halfHour;
      }
    }
    if (fields.start === undefined && fields.end === undefined) {
      if (end - start < MIN_BOOKING_MINUTES) fields.end = SHAPE_SENTENCES.length;
      const startMin = minutesOfDay(clock, start);
      const endMin = minutesOfDay(clock, end);
      if (startMin < OPENS_MIN || startMin >= CLOSSES_MIN) fields.start = fields.start ?? SHAPE_SENTENCES.hours;
      if (clock.dateKey(end) !== clock.dateKey(start) || endMin > CLOSSES_MIN) fields.end = fields.end ?? SHAPE_SENTENCES.hours;
      if (fields.start === undefined && fields.end === undefined) {
        const status = spanStatus(clock, now, start);
        if (status === 'started') fields.start = SHAPE_SENTENCES.started;
        else if (status === 'beyond_horizon') fields.start = SHAPE_SENTENCES.horizon;
      }
      if (isMove && fields.start === undefined && fields.end === undefined && input.current) {
        const same = input.current.stationId === stationId
          && (input.current.shelfId ?? null) === shelfId
          && input.current.start === start && input.current.end === end;
        if (same) fields.start = SHAPE_SENTENCES.same;
      }
    }
  }

  if (Object.keys(fields).length > 0) return { fields };
  return { fields: {}, start, end, stationId, shelfId };
}

export function bookingMinutes(start: number, end: number, stationCount: number): number {
  return (Math.round((end - start) / 60_000)) * stationCount;
}

// A booking's cutoff: the same wall-clock time on the calendar day before its start.
export function cutoffFor(clock: KitchenClock, startEpoch: number): number {
  const p = clock.parts(startEpoch);
  const prevKey = clock.addDaysKey(clock.dateKey(startEpoch), -1);
  const [y, m, d] = prevKey.split('-').map(Number);
  return clock.fromWall(y, m, d, p.hour, p.minute, p.second);
}

export type CoverState = 'ok' | 'expires_soon' | 'expires_today' | 'lapsed' | 'superseded';

// The cover rule, shared by bookings, clearance, onboarding and display.
export function documentCovers(expiresOn: string, dateKey: string): boolean {
  return dateKey <= expiresOn;
}

export function coverState(todayKey: string, expiresOn: string, superseded: boolean): { state: CoverState; daysLeft: number | null } {
  if (superseded) return { state: 'superseded', daysLeft: null };
  if (todayKey > expiresOn) return { state: 'lapsed', daysLeft: null };
  // days from today to expiresOn
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const [ey, em, ed] = expiresOn.split('-').map(Number);
  const t = Date.UTC(ty, tm - 1, td);
  const e = Date.UTC(ey, em - 1, ed);
  const days = Math.round((e - t) / 86_400_000);
  if (days === 0) return { state: 'expires_today', daysLeft: 0 };
  if (days <= EXPIRY_SOON_DAYS) return { state: 'expires_soon', daysLeft: days };
  return { state: 'ok', daysLeft: days };
}

// Prorated refund in whole cents with the remainder dropped.
export function refundCents(priceCents: number, balanceMinutes: number, purchasedMinutes: number): number {
  if (purchasedMinutes <= 0) return 0;
  return Math.floor((priceCents * balanceMinutes) / purchasedMinutes);
}

export type BookingStatus = 'held' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';

export function durationText(minutes: number): string {
  if (minutes <= 0) return '0 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
