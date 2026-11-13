import type { BandName, Difficulty } from "../../shared/api.js";

/** Difficulty multiplier d in halves: trivial 0.5, easy 1, medium 1.5, hard 2. */
const DIFFICULTY_HALVES: Record<Difficulty, number> = { trivial: 1, easy: 2, medium: 3, hard: 4 };

const VALUE_MIN = -20;
const VALUE_MAX = 20;

interface Band {
  name: BandName;
  /** Factor f in quarters: 2, 1.5, 1, 0.75, 0.5. */
  quarters: number;
}

export function bandOf(value: number): Band {
  if (value <= -10) return { name: "Crimson", quarters: 8 };
  if (value <= -1) return { name: "Amber", quarters: 6 };
  if (value <= 4) return { name: "Sand", quarters: 4 };
  if (value <= 9) return { name: "Teal", quarters: 3 };
  return { name: "Blue", quarters: 2 };
}

export function clampValue(value: number): number {
  return Math.max(VALUE_MIN, Math.min(VALUE_MAX, value));
}

/** Round the fraction numerator/denominator half up to a whole number. */
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Experience for completing a daily or to-do, or scoring a habit up: round(10 x d x f x checklist bonus). */
export function experienceFor(difficulty: Difficulty, value: number, checked = 0, total = 0): number {
  const base = 10 * DIFFICULTY_HALVES[difficulty] * bandOf(value).quarters;
  return total === 0 ? roundHalfUp(base, 8) : roundHalfUp(base * (2 * total + checked), 16 * total);
}

export function goldCentsFor(experience: number): number {
  return experience * 10;
}

export function damageTenthsFor(experience: number): number {
  return experience * 5;
}

/** Health lost, in tenths, for scoring a habit down or missing a daily: round(2 x d x f) to one decimal. */
export function healthLossTenths(difficulty: Difficulty, value: number): number {
  return roundHalfUp(5 * DIFFICULTY_HALVES[difficulty] * bandOf(value).quarters, 2);
}
