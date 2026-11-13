import { businessNow } from './clock.js';
import { query } from './db.js';
import { fail } from './errors.js';

export const CHARITY_NAME = 'Varmestuen Nord';
export const SEED_RATE_BASIS_POINTS = 3150;

/** The rate in force at an instant; a rate applies from its instant inclusive. */
export async function rateAt(instant: Date): Promise<number> {
  const rows = await query<{ rate_basis_points: number }>(
    `SELECT rate_basis_points FROM charity_rates
      WHERE effective_from <= $1
      ORDER BY effective_from DESC, id DESC
      LIMIT 1`,
    [instant],
  );
  return rows[0]?.rate_basis_points ?? SEED_RATE_BASIS_POINTS;
}

export async function rateHistory(): Promise<{ rateBasisPoints: number; effectiveFrom: string }[]> {
  const rows = await query<{ rate_basis_points: number; effective_from: Date }>(
    'SELECT rate_basis_points, effective_from FROM charity_rates ORDER BY effective_from',
  );
  return rows.map((row) => ({
    rateBasisPoints: row.rate_basis_points,
    effectiveFrom: row.effective_from.toISOString(),
  }));
}

export async function scheduleRate(
  rateBasisPoints: unknown,
  effectiveFrom: unknown,
): Promise<{ rateBasisPoints: number; effectiveFrom: string }> {
  if (
    typeof rateBasisPoints !== 'number' ||
    !Number.isInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > 10000
  ) {
    throw fail(422, 'rate_invalid');
  }
  if (typeof effectiveFrom !== 'string' || Number.isNaN(new Date(effectiveFrom).getTime())) {
    throw fail(422, 'rate_must_be_future');
  }
  const instant = new Date(effectiveFrom);
  if (instant.getTime() <= businessNow().getTime()) throw fail(422, 'rate_must_be_future');
  await query('INSERT INTO charity_rates (rate_basis_points, effective_from) VALUES ($1, $2)', [
    rateBasisPoints,
    instant,
  ]);
  return { rateBasisPoints, effectiveFrom: instant.toISOString() };
}
