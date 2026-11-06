import { pool, type Queryable } from '../pool.js';
import type { PolicyRecord } from '../../domain/types.js';

interface PolicyRow {
  version: number;
  free_window_hours: number;
  late_fee_percent: number;
  effective_at: Date;
}

function toPolicy(row: PolicyRow): PolicyRecord {
  return {
    version: row.version,
    freeWindowHours: row.free_window_hours,
    lateFeePercent: row.late_fee_percent,
    effectiveAt: row.effective_at,
  };
}

export async function listPolicies(): Promise<PolicyRecord[]> {
  const result = await pool.query<PolicyRow>(
    'SELECT * FROM cancellation_policies ORDER BY version DESC',
  );
  return result.rows.map(toPolicy);
}

export async function currentPolicy(db: Queryable = pool): Promise<PolicyRecord> {
  const result = await db.query<PolicyRow>(
    'SELECT * FROM cancellation_policies ORDER BY version DESC LIMIT 1',
  );
  const row = result.rows[0];
  if (!row) throw new Error('No cancellation policy version exists');
  return toPolicy(row);
}

export async function findPolicy(version: number): Promise<PolicyRecord> {
  const result = await pool.query<PolicyRow>(
    'SELECT * FROM cancellation_policies WHERE version = $1',
    [version],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`No cancellation policy version ${version}`);
  return toPolicy(row);
}

export async function insertPolicy(
  db: Queryable,
  policy: PolicyRecord,
): Promise<void> {
  await db.query(
    `INSERT INTO cancellation_policies (version, free_window_hours, late_fee_percent, effective_at)
     VALUES ($1,$2,$3,$4)`,
    [policy.version, policy.freeWindowHours, policy.lateFeePercent, policy.effectiveAt],
  );
}
