export type Fare = 'regular' | 'reduced' | 'member' | 'member-guest' | 'group';
export type Tier = 'friend' | 'cinephile' | 'projectionist';
export type Cadence = 'annual' | 'monthly';
export type Format = '35mm' | '16mm' | 'DCP';
export type AuditoriumCode = 'MH1' | 'MH2' | 'AC1';
export type StepupPurpose = 'checkout' | 'gift' | 'membership';
export type SeasonState = 'draft' | 'scheduled' | 'member-priority' | 'on-sale' | 'archived' | 'withdrawn';
export type BookingState = 'held' | 'paid' | 'checked-in' | 'expired' | 'refunded';
export type TicketStatus = 'issued' | 'checked-in' | 'refunded';
export type Role = 'patron' | 'door' | 'programmer' | 'finance';

export const FARES: Fare[] = ['regular', 'reduced', 'member', 'member-guest', 'group'];
export const TIERS: Tier[] = ['friend', 'cinephile', 'projectionist'];
export const CADENCES: Cadence[] = ['annual', 'monthly'];
export const FORMATS: Format[] = ['35mm', '16mm', 'DCP'];
export const AUDITORIUMS: AuditoriumCode[] = ['MH1', 'MH2', 'AC1'];
export const LOCALES = ['en', 'fr'] as const;
export const STEPUP_PURPOSES: StepupPurpose[] = ['checkout', 'gift', 'membership'];

export const FARE_PRICES: Record<Fare, number> = {
  regular: 1400,
  reduced: 1100,
  member: 1000,
  'member-guest': 1200,
  group: 950,
};

export const TIER_PLANS: Record<Tier, { annual: number; monthly: number; allowance: number; rank: number }> = {
  friend: { annual: 6000, monthly: 600, allowance: 1, rank: 1 },
  cinephile: { annual: 12000, monthly: 1200, allowance: 2, rank: 2 },
  projectionist: { annual: 24000, monthly: 2400, allowance: 3, rank: 3 },
};

export const UPLIFT_PRESETS = [200, 500, 1000];
export const UPLIFT_MIN = 100;
export const UPLIFT_MAX = 50000;
export const GOODWILL_MIN = 100;
export const GOODWILL_MAX = 50000;

export const REFUND_CUTOFF_SECONDS = 2 * 60 * 60;
export const CHECKIN_OPENS_SECONDS = 45 * 60;
export const CHECKIN_CLOSES_SECONDS = 30 * 60;
export const STEPUP_MAX_ATTEMPTS = 5;
export const STEPUP_RESEND_SPACING_SECONDS = 30;
export const STEPUP_MAX_SENDS = 4;
export const OUTBOX_MAX_ATTEMPTS = 20;
export const OUTBOX_BACKOFF_SECONDS = [5, 15, 45];
export const OUTBOX_BACKOFF_TAIL_SECONDS = 60;

export function fareLabelKey(fare: Fare): string {
  return `fare_${fare}`;
}

export function tierLabelKey(tier: Tier): string {
  return `tier_${tier}`;
}

export function cadenceLabelKey(cadence: Cadence | 'gift'): string {
  return `cadence_${cadence}`;
}

export function planName(tier: Tier, cadence: Cadence | 'gift'): string {
  return `${tier}-${cadence}`;
}

export function seatOrder(seat: string): [string, number] {
  const row = seat.replace(/[0-9]/g, '');
  const number = Number(seat.replace(/[^0-9]/g, ''));
  return [row, number];
}

export function compareSeats(a: string, b: string): number {
  const [rowA, numberA] = seatOrder(a);
  const [rowB, numberB] = seatOrder(b);
  if (rowA !== rowB) return rowA < rowB ? -1 : 1;
  return numberA - numberB;
}

export function sortSeats(seats: string[]): string[] {
  return [...seats].sort(compareSeats);
}
