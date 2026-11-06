import { errors } from '../http/errors.js';
import { withTransaction } from '../db/pool.js';
import { currentPolicy, insertPolicy, listPolicies } from '../db/repo/policy.js';
import { recordStateChange } from '../db/repo/audit.js';
import type { PolicyRecord } from '../domain/types.js';

export async function policyHistory(): Promise<{ current: PolicyRecord; history: PolicyRecord[] }> {
  const history = await listPolicies();
  return { current: history[0]!, history };
}

export async function savePolicy(
  actorUserId: string,
  freeWindowHours: number,
  lateFeePercent: number,
  basedOnVersion: number,
): Promise<PolicyRecord> {
  const failures: Record<string, string> = {};
  if (!Number.isInteger(freeWindowHours) || freeWindowHours < 0 || freeWindowHours > 168) {
    failures['free_window_hours'] = 'Give a free window from 0 to 168 hours.';
  }
  if (!Number.isInteger(lateFeePercent) || lateFeePercent < 0 || lateFeePercent > 100) {
    failures['late_fee_percent'] = 'Give a late charge from 0 to 100 percent.';
  }
  if (!Number.isInteger(basedOnVersion)) {
    failures['based_on_version'] = 'Give the version this change is based on.';
  }
  if (Object.keys(failures).length > 0) throw errors.validation(failures);

  return withTransaction(async (tx) => {
    const current = await currentPolicy(tx);
    if (current.version !== basedOnVersion) throw errors.staleVersion(current.version);
    const next: PolicyRecord = {
      version: current.version + 1,
      freeWindowHours,
      lateFeePercent,
      effectiveAt: new Date(),
    };
    await insertPolicy(tx, next);
    await recordStateChange(tx, {
      actorUserId,
      entity: 'cancellation_policy',
      entityId: String(next.version),
      fromState: String(current.version),
      toState: String(next.version),
      detail: { free_window_hours: freeWindowHours, late_fee_percent: lateFeePercent },
    });
    return next;
  });
}
