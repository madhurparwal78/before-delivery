import type { BandName, Difficulty } from '../../shared/types.js';

export const DIFFICULTIES: Difficulty[] = ['trivial', 'easy', 'medium', 'hard'];

/** Difficulty multiplier d, in hundredths. */
const DIFFICULTY_HUNDREDTHS: Record<Difficulty, number> = {
  trivial: 50,
  easy: 100,
  medium: 150,
  hard: 200,
};

interface Band {
  name: BandName;
  factorHundredths: number;
}

/** The band table. A value's band and factor f are read from the value before an action changes it. */
export function bandOf(value: number): Band {
  if (value <= -10) return { name: 'Crimson', factorHundredths: 200 };
  if (value <= -1) return { name: 'Amber', factorHundredths: 150 };
  if (value <= 4) return { name: 'Sand', factorHundredths: 100 };
  if (value <= 9) return { name: 'Teal', factorHundredths: 75 };
  return { name: 'Blue', factorHundredths: 50 };
}

export function bandName(value: number): BandName {
  return bandOf(value).name;
}

export const VALUE_MIN = -20;
export const VALUE_MAX = 20;

export function clampValue(value: number): number {
  return Math.min(VALUE_MAX, Math.max(VALUE_MIN, value));
}

/** Half up to a whole number, from an exact ratio of positive integers. */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export interface Payout {
  experience: number;
  goldCents: number;
  damageTenths: number;
}

/**
 * Completing a daily or to-do, or scoring a habit up.
 * `checked` of `total` checklist items raise the payout by the checklist bonus.
 */
export function payoutFor(difficulty: Difficulty, value: number, checked = 0, total = 0): Payout {
  const d = DIFFICULTY_HUNDREDTHS[difficulty];
  const f = bandOf(value).factorHundredths;
  const bonusNumerator = total > 0 ? 2 * total + checked : 1;
  const bonusDenominator = total > 0 ? 2 * total : 1;
  const experience = roundHalfUp(d * f * bonusNumerator, 1000 * bonusDenominator);
  return { experience, goldCents: experience * 10, damageTenths: experience * 5 };
}

/** Scoring a habit down, or a missed daily at a close: the health lost, in tenths. */
export function healthLossTenths(difficulty: Difficulty, value: number): number {
  const d = DIFFICULTY_HUNDREDTHS[difficulty];
  const f = bandOf(value).factorHundredths;
  return roundHalfUp(20 * d * f, 10_000);
}

/** The boss's strike-back against each member, in tenths. */
export function strikeBackTenths(powerTenths: number, missed: number): number {
  return powerTenths * missed;
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as string[]).includes(value);
}
