import type { ServiceLine } from '../../shared/contract.js';
import type { RateInForce } from '../domain/charges.js';
import type { Queryable } from './pool.js';

/** The rate entry with the latest effective date on or before the given agency-zone date. */
export async function rateInForce(
  db: Queryable,
  orgId: number,
  serviceLine: ServiceLine,
  agencyDate: string,
): Promise<RateInForce | null> {
  const result = await db.query<RateInForce>(
    `SELECT effective_from, hourly_rate_cents, mileage_cents_per_mile
     FROM rate_cards
     WHERE org_id = $1 AND service_line = $2 AND effective_from <= $3::date
     ORDER BY effective_from DESC
     LIMIT 1`,
    [orgId, serviceLine, agencyDate],
  );
  return result.rows[0] ?? null;
}
