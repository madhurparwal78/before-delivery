import { query, type Queryable } from '../db/pool.ts';
import { CLAIMING_STATUSES } from '../../shared/enquiryStatus.ts';
import { monthLabel } from '../../shared/dates.ts';

export type ProductionMonth = {
  month: string;
  label: string;
  capacity: number;
  claimed: number;
  open: boolean;
};

/** A month's claimed count is always counted from its accepted, deposit-paid and booked enquiries. */
const CLAIMED_SQL = `(
  SELECT count(*) FROM proposals pr
    JOIN enquiries e ON e.id = pr.enquiry_id
   WHERE pr.production_month = m.month
     AND e.status = ANY($1::text[])
)`;

function toMonth(row: { month: string; capacity: number; claimed: string | number }): ProductionMonth {
  const claimed = Number(row.claimed);
  return {
    month: row.month,
    label: monthLabel(row.month),
    capacity: row.capacity,
    claimed,
    open: claimed < row.capacity,
  };
}

export async function readMonthsFrom(currentMonth: string, client?: Queryable): Promise<ProductionMonth[]> {
  const runner = client ?? { query };
  const result = await runner.query<{ month: string; capacity: number; claimed: string }>(
    `SELECT m.month, m.capacity, ${CLAIMED_SQL} AS claimed
       FROM production_months m
      WHERE m.month >= $2
      ORDER BY m.month ASC`,
    [[...CLAIMING_STATUSES], currentMonth],
  );
  return result.rows.map(toMonth);
}

export async function readMonth(month: string, client?: Queryable): Promise<ProductionMonth | null> {
  const runner = client ?? { query };
  const result = await runner.query<{ month: string; capacity: number; claimed: string }>(
    `SELECT m.month, m.capacity, ${CLAIMED_SQL} AS claimed
       FROM production_months m WHERE m.month = $2`,
    [[...CLAIMING_STATUSES], month],
  );
  const row = result.rows[0];
  return row === undefined ? null : toMonth(row);
}

/**
 * Locks the month's record so capacity changes and acceptances are taken one at a time,
 * then reports its capacity and claimed count. A month with no capacity set has capacity 0.
 */
export async function lockMonth(client: Queryable, month: string): Promise<ProductionMonth> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('production-month'), hashtext($1))`, [month]);
  const existing = await readMonth(month, client);
  return existing ?? { month, label: monthLabel(month), capacity: 0, claimed: 0, open: false };
}

export async function upsertCapacity(client: Queryable, month: string, capacity: number): Promise<void> {
  await client.query(
    `INSERT INTO production_months (month, capacity) VALUES ($1, $2)
     ON CONFLICT (month) DO UPDATE SET capacity = EXCLUDED.capacity`,
    [month, capacity],
  );
}
