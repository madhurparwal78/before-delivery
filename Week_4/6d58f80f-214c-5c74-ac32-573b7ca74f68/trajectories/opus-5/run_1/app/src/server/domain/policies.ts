import { db, type Queryable } from '../db.js';
import type { PolicyKind } from '../../shared/types.js';
import type { PolicyRow } from './rows.js';

export const POLICY_LIMITS: Record<PolicyKind, { min: number; max: number }> = {
  bin_retention_days: { min: 1, max: 90 },
  partner_grant_days: { min: 1, max: 365 },
};

export const allPolicies = async (tx: Queryable = db): Promise<PolicyRow[]> => {
  const { rows } = await tx.query<PolicyRow>(
    'SELECT id, kind, days, effective_from FROM policies ORDER BY kind, effective_from DESC',
  );
  return rows;
};

/** The rule of a kind in force on a company date: the latest row effective on or before it. */
export const policyInForce = async (
  kind: PolicyKind,
  onDate: string,
  tx: Queryable = db,
): Promise<PolicyRow> => {
  const { rows } = await tx.query<PolicyRow>(
    `SELECT id, kind, days, effective_from FROM policies
      WHERE kind = $1 AND effective_from <= $2
      ORDER BY effective_from DESC LIMIT 1`,
    [kind, onDate],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no ${kind} policy in force on ${onDate}`);
  return row;
};

export const daysInForce = async (
  kind: PolicyKind,
  onDate: string,
  tx: Queryable = db,
): Promise<number> => (await policyInForce(kind, onDate, tx)).days;
