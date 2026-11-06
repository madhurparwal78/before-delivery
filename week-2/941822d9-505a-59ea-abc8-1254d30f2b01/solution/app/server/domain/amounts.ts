// Exact integer arithmetic for money (cents), percentages (basis points) and hours (quarter hours).

/** Floor division of non-negative integers without floating point. */
export const quotient = (dividend: number, divisor: number): number => (dividend - (dividend % divisor)) / divisor;

const MONEY_RE = /^(\d{1,7})\.(\d{2})$/;
const PERCENT_RE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "45.50" -> 4550; null when the string is not a two-decimal money amount. */
export function parseMoney(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = MONEY_RE.exec(value);
  if (!match) return null;
  return parseInt(match[1] ?? "0", 10) * 100 + parseInt(match[2] ?? "0", 10);
}

/** Two-decimal text for a whole number of hundredths (cents, basis points). */
const hundredths = (value: number): string => `${quotient(value, 100)}.${String(value % 100).padStart(2, "0")}`;

export const formatMoney = (cents: number): string => hundredths(cents);

/** "33.33" -> 3333 basis points; null when not 0..100 with at most two decimals. */
export function parsePercent(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = PERCENT_RE.exec(value);
  if (!match) return null;
  const basisPoints = parseInt(match[1] ?? "0", 10) * 100 + parseInt((match[2] ?? "0").padEnd(2, "0"), 10);
  return basisPoints <= 10_000 ? basisPoints : null;
}

export const formatPercent = (basisPoints: number): string => hundredths(basisPoints);

/** Contact hours as quarter hours: minutes / 60 rounded down to the nearest 0.25. */
export const awardedQuarters = (minutes: number): number => quotient(minutes * 4, 60);

export const formatHours = (quarters: number): string => `${quotient(quarters, 4)}.${String((quarters % 4) * 25).padStart(2, "0")}`;

interface ShareSplit {
  employerCents: number;
  learnerCents: number;
}

/** The co-pay rule: employer share rounded down to the cent, learner pays the remainder. */
export function splitShares(listPriceCents: number, coverageBasisPoints: number): ShareSplit {
  const employerCents = quotient(listPriceCents * coverageBasisPoints, 10_000);
  return { employerCents, learnerCents: listPriceCents - employerCents };
}
