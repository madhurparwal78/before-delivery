import type { DateTime } from 'luxon';
import { DateTime as Luxon } from 'luxon';
import { torontoTz } from '../time';

export type Locale = 'en' | 'fr';
export type Fare = 'regular' | 'reduced' | 'member' | 'member-guest' | 'group';
export type Tier = 'friend' | 'cinephile' | 'projectionist';
export type Cadence = 'annual' | 'monthly';
export type StepupPurpose = 'checkout' | 'gift' | 'membership';
export type SeasonState = 'draft' | 'scheduled' | 'member-priority' | 'on-sale' | 'archived' | 'withdrawn';
export type BookingState = 'held' | 'paid' | 'checked-in' | 'expired' | 'refunded';
export type TicketStatus = 'issued' | 'checked-in' | 'refunded';
export type AccountRole = 'patron' | 'door' | 'programmer' | 'finance';
export type AuditAction = 'refund' | 'goodwill-credit' | 'reconciliation-accept' | 'season-withdraw' | 'enquiry-reply';
export type LedgerAccount = 'member-credit' | 'goodwill-expense' | 'credit-redeemed';
export type MovementKind = 'goodwill' | 'spend' | 'reversal';

export const fareOrder: Fare[] = ['regular', 'reduced', 'member', 'member-guest', 'group'];
export const farePrices: Record<Fare, number> = {
  regular: 1400,
  reduced: 1100,
  member: 1000,
  'member-guest': 1200,
  group: 950,
};

export const tierPrices: Record<Tier, { annual: number; monthly: number; guestAllowance: number }> = {
  friend: { annual: 6000, monthly: 600, guestAllowance: 1 },
  cinephile: { annual: 12000, monthly: 1200, guestAllowance: 2 },
  projectionist: { annual: 24000, monthly: 2400, guestAllowance: 3 },
};

export const tierRank: Record<Tier, number> = { friend: 0, cinephile: 1, projectionist: 2 };

export const upliftPresets = [200, 500, 1000];
export const upliftMinCents = 100;
export const upliftMaxCents = 50000;
export const goodwillMinCents = 100;
export const goodwillMaxCents = 50000;

export const individualHoldMin = 1;
export const individualHoldMax = 10;
export const groupHoldMin = 10;
export const groupHoldMax = 40;
export const payerMin = 2;
export const payerMax = 6;
export const refundCutoffHours = 2;
export const checkinOpenMinutes = 45;
export const checkinCloseMinutes = 30;

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'fr';
export const isFare = (v: unknown): v is Fare => typeof v === 'string' && (fareOrder as string[]).includes(v);
export const isTier = (v: unknown): v is Tier => v === 'friend' || v === 'cinephile' || v === 'projectionist';
export const isCadence = (v: unknown): v is Cadence => v === 'annual' || v === 'monthly';
export const isPurpose = (v: unknown): v is StepupPurpose => v === 'checkout' || v === 'gift' || v === 'membership';
export const isRole = (v: unknown): v is AccountRole =>
  v === 'patron' || v === 'door' || v === 'programmer' || v === 'finance';

export function otherLocale(l: Locale): Locale {
  return l === 'en' ? 'fr' : 'en';
}

/**
 * Per-admission-line tax with half-up rounding to the cent, done once per line
 * and per tax. GST = (subtotal*5 + 50) div 100; QST = (subtotal*9975 + 50000) div 100000.
 */
export const gstFor = (subtotalCents: number): number => Math.floor((subtotalCents * 5 + 50) / 100);
export const qstFor = (subtotalCents: number): number => Math.floor((subtotalCents * 9975 + 50000) / 100000);

export interface FareLine {
  fare: Fare;
  quantity: number;
  unit_cents: number;
  subtotal_cents: number;
  gst_cents: number;
  qst_cents: number;
}

export interface PriceBreakdown {
  lines: FareLine[];
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  total_cents: number;
}

/** The one place that computes admission lines and tax for a set of seats and fares. */
export function priceBreakdown(fares: { seat: string; fare: Fare }[], upliftCents: number): PriceBreakdown {
  const byFare = new Map<Fare, number>();
  for (const s of fares) byFare.set(s.fare, (byFare.get(s.fare) ?? 0) + 1);
  const lines: FareLine[] = [];
  let admission = 0;
  let gst = 0;
  let qst = 0;
  for (const fare of fareOrder) {
    const quantity = byFare.get(fare);
    if (!quantity) continue;
    const subtotal = quantity * farePrices[fare];
    const lineGst = gstFor(subtotal);
    const lineQst = qstFor(subtotal);
    lines.push({ fare, quantity, unit_cents: farePrices[fare], subtotal_cents: subtotal, gst_cents: lineGst, qst_cents: lineQst });
    admission += subtotal;
    gst += lineGst;
    qst += lineQst;
  }
  const total = admission + gst + qst + upliftCents;
  return {
    lines,
    admission_cents: admission,
    gst_cents: gst,
    qst_cents: qst,
    uplift_cents: upliftCents,
    total_cents: total,
  };
}

export interface PayerShare { name: string; seats: number; share_cents: number }

/** Largest-remainder cost split; shares always sum exactly to totalCents. */
export function costSplit(totalCents: number, payers: { name: string; seats: number }[]): PayerShare[] {
  const S = payers.reduce((sum, p) => sum + p.seats, 0);
  const base = payers.map(p => Math.floor((totalCents * p.seats) / S));
  const remainder = payers.map((p, i) => (totalCents * p.seats) % S);
  let leftover = totalCents - base.reduce((a, b) => a + b, 0);
  const order = payers.map((_, i) => i)
    .sort((a, b) => remainder[b] - remainder[a] || a - b);
  const extra = new Array<number>(payers.length).fill(0);
  for (const i of order) {
    if (leftover > 0) { extra[i] += 1; leftover -= 1; }
  }
  return payers.map((p, i) => ({ name: p.name, seats: p.seats, share_cents: base[i] + extra[i] }));
}

/** Sale instants: 10:00 Toronto wall clock; priority opens 3 calendar days earlier. */
export function publicOpensAt(publicSaleDate: string): DateTime {
  return Luxon.fromISO(`${publicSaleDate}T10:00:00`, { zone: torontoTz });
}

export function priorityOpensAt(publicSaleDate: string): DateTime {
  return Luxon.fromISO(`${publicSaleDate}T10:00:00`, { zone: torontoTz }).minus({ days: 3 });
}

/** The one place a season's time-derived state is decided. */
export function seasonTimeDerived(
  publicSaleDate: string,
  nowInstant: DateTime,
): 'scheduled' | 'member-priority' | 'on-sale' {
  if (nowInstant < priorityOpensAt(publicSaleDate)) return 'scheduled';
  if (nowInstant < publicOpensAt(publicSaleDate)) return 'member-priority';
  return 'on-sale';
}

/** The refund cutoff: strictly before showtime - 2 hours. */
export function refundDeadline(startsAt: DateTime): DateTime {
  return startsAt.minus({ hours: refundCutoffHours });
}

/** The check-in window: [showtime - 45m, showtime + 30m). */
export function checkinWindow(startsAt: DateTime): { opensAt: DateTime; closesAt: DateTime } {
  return {
    opensAt: startsAt.minus({ minutes: checkinOpenMinutes }),
    closesAt: startsAt.plus({ minutes: checkinCloseMinutes }),
  };
}

/**
 * Weekly slot instants. Occurrence n is first_local + 7n calendar days at the
 * same wall-clock time, converted with that date's Toronto offset. Luxon's
 * zone handling gives exactly the published rules: a local time that does not
 * exist moves forward one hour, and one that occurs twice takes the first
 * (daylight-time) occurrence.
 */
export function weeklyInstants(firstLocal: string, weeks: number): DateTime[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(firstLocal);
  if (!m) throw new Error(`bad local datetime: ${firstLocal}`);
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  const hour = Number(m[4]); const minute = Number(m[5]);
  const out: DateTime[] = [];
  for (let n = 0; n < weeks; n++) {
    const date = Luxon.fromISO(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, { zone: torontoTz })
      .plus({ days: 7 * n });
    const dt = Luxon.fromObject(
      { year: date.year, month: date.month, day: date.day, hour, minute, second: 0 },
      { zone: torontoTz },
    );
    out.push(dt);
  }
  return out;
}
