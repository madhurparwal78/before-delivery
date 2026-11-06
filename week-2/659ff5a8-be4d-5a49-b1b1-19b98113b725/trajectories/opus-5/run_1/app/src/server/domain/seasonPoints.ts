import { roundHalfUpDiv } from './decimal';

/** The one place the season points formula lives. */
export function eventPointsThousandths(
  fastestIndexedMs: number | null,
  driverBestIndexedMs: number | null,
): number {
  if (fastestIndexedMs === null || driverBestIndexedMs === null) return 0;
  return roundHalfUpDiv(100_000n * BigInt(fastestIndexedMs), BigInt(driverBestIndexedMs));
}

export function formatPoints(thousandths: number): string {
  const whole = Math.trunc(thousandths / 1000);
  const fraction = thousandths % 1000;
  return `${whole}.${String(fraction).padStart(3, '0')}`;
}
