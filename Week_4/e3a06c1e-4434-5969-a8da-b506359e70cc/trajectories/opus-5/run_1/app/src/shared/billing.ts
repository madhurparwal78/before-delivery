import type { Plan } from './types.js';

const centsPerMinute: Record<Plan, number> = { pilot: 6, scale: 3 };

/** Billable seconds for one session, under the plan in force when it started. */
export const billableSeconds = (plan: Plan, audioMs: number, channels: number): number => {
  if (audioMs === 0) return 0;
  if (plan === 'pilot') return channels * 60 * Math.ceil(audioMs / 60000);
  return channels * Math.max(15, Math.ceil(audioMs / 1000));
};

/** The single rounding step from billable seconds to integer cents, per plan. */
export const costCents = (plan: Plan, seconds: number): number =>
  Math.ceil((seconds * centsPerMinute[plan]) / 60);

export const roundHalfUp2 = (value: number): number => {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const rounded = frac >= 0.5 ? floor + 1 : floor;
  return rounded / 100;
};

export const billableMinutesText = (seconds: number): string => roundHalfUp2(seconds / 60).toFixed(2);

export const costText = (cents: number): string => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

export const quotaMeterText = (usedSeconds: number, limitMinutes: number): string =>
  `${roundHalfUp2(usedSeconds / 60).toFixed(2)} / ${limitMinutes} min`;

export const quotaMeterPercent = (usedSeconds: number, limitMinutes: number): number => {
  const raw = (usedSeconds / (limitMinutes * 60)) * 100;
  const floor = Math.floor(raw);
  const value = raw - floor >= 0.5 ? floor + 1 : floor;
  return Math.min(100, value);
};

export const werText = (wer: number | null): string => (wer === null ? 'n/a' : `${(wer * 100).toFixed(2)}%`);

const validLength = /^\d+(\.\d{1,3})?$/;

/** The public calculator's valid length: digits, optional point, at most three decimals, 0 to 3600. */
export const parseCalculatorLength = (raw: string): number | null => {
  if (!validLength.test(raw)) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return null;
  return Math.round(seconds * 1000);
};
