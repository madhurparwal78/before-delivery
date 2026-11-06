/** Domain rules that both the server and the screens call. Each rule is written here once. */

const CONE_PENALTY_MS = 2000;
const RAW_TIME_MIN_MS = 10_000;
const RAW_TIME_MAX_MS = 999_999;
export const MAX_CONES = 30;

/** Thousandths of a second as the three-decimal text the API and the screens show. */
export function formatMs(ms: number): string {
  const whole = Math.floor(ms / 1000);
  const fraction = String(ms % 1000).padStart(3, "0");
  return `${whole}.${fraction}`;
}

/** A raw time typed as text (`45.123`), in thousandths, or null when it is not a valid time. */
export function parseRawTime(text: string): number | null {
  const match = /^(\d{2,3})\.(\d{3})$/.exec(text);
  if (!match) return null;
  const ms = Number(match[1]) * 1000 + Number(match[2]);
  return ms >= RAW_TIME_MIN_MS && ms <= RAW_TIME_MAX_MS ? ms : null;
}

/** Factors are stored as integer ten-thousandths (`0.8270` is 8270). */
export function parseFactor(text: string): number | null {
  const match = /^(\d)\.(\d{4})$/.exec(text);
  if (!match) return null;
  const basisPoints = Number(match[1]) * 10_000 + Number(match[2]);
  return basisPoints >= 4000 && basisPoints <= 12_000 ? basisPoints : null;
}

export function formatFactor(basisPoints: number): string {
  return `${Math.floor(basisPoints / 10_000)}.${String(basisPoints % 10_000).padStart(4, "0")}`;
}

export function adjustedMs(rawMs: number, cones: number): number {
  return rawMs + CONE_PENALTY_MS * cones;
}

/** Indexed time: adjusted times the factor, rounded half up to the thousandth, in exact integer arithmetic. */
export function indexedMs(adjusted: number, factorBasisPoints: number): number {
  return Math.floor((adjusted * factorBasisPoints + 5000) / 10_000);
}

/** The orange penalty readout after `chips` cones have dropped, for example `+4.000`. */
export function penaltyReadout(chips: number): string {
  return `+${formatMs(CONE_PENALTY_MS * chips)}`;
}

/** The rank-change badge for one view, from the entry's position just before and just after a change. */
export function rankChangeText(before: number | null, after: number | null): string {
  if (after === null) return "No time";
  if (before === null) return `New P${after}`;
  if (after < before) return `Up ${before - after} to P${after}`;
  if (after > before) return `Down ${after - before} to P${after}`;
  return `Holds P${after}`;
}

interface DatedTable<T> {
  effectiveDate: string;
  factors: T;
}

/** The table in force on a date: the latest one effective on or before it. */
export function tableInForce<T extends DatedTable<unknown>>(tables: readonly T[], date: string): T | null {
  let found: T | null = null;
  for (const table of tables) {
    if (table.effectiveDate <= date && (found === null || table.effectiveDate > found.effectiveDate)) found = table;
  }
  return found;
}

/**
 * Season points in thousandths: 100 times the fastest best indexed time of the event over the driver's,
 * rounded half up to the thousandth. A driver with no valid time scores zero.
 */
export function seasonPointsMs(fastestIndexed: number, driverIndexed: number | null): number {
  if (driverIndexed === null) return 0;
  return Math.floor((200_000 * fastestIndexed + driverIndexed) / (2 * driverIndexed));
}
