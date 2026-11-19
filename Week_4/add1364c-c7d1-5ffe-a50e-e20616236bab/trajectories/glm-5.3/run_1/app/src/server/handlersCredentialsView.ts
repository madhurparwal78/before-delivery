import type { Ctx } from './apiRoutes.js';
import { policyView, ruleInForceAt, type RuleRow } from './domain/rules.js';
import { mapRuleRow } from './handlersRules.js';
import { officeDateString } from './officeTime.js';

/** The `<credential>` response view. A credential response never contains the secret. */
export async function credentialView(ctx: Ctx, row: Record<string, unknown>, secretLength: number): Promise<Record<string, unknown>> {
  const credentialId = String(row.id);
  const vaultId = String(row.vault_id);
  const rulesRows = await ctx.store.pool.query('SELECT * FROM rules');
  const rules: RuleRow[] = rulesRows.rows.map(mapRuleRow);
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  const rule = ruleInForceAt(rules, vaultId, today);
  const storedSince = row.out_of_policy_since ? String(row.out_of_policy_since).slice(0, 10) : null;
  const lastTurned = row.last_turned_on ? String(row.last_turned_on).slice(0, 10) : null;
  const policy = policyView(rule, secretLength, lastTurned, storedSince, today);
  const holders = await ctx.store.pool.query(
    `SELECT ch.person_id, ch.holder_left AS is_left, p.full_name FROM credential_holders ch
     JOIN people p ON p.id = ch.person_id WHERE ch.credential_id = $1`,
    [credentialId]
  );
  const openTurn = await ctx.store.pool.query(
    `SELECT due_by, office_time, offset_abbrev AS offset FROM turns WHERE credential_id = $1 AND state IN ('due','overdue') ORDER BY due_by LIMIT 1`,
    [credentialId]
  );
  let nextTurn: { office_date: string; office_time: string; offset: string } | null = null;
  if (openTurn.rows.length > 0) {
    nextTurn = {
      office_date: String(openTurn.rows[0].due_by).slice(0, 10),
      office_time: String(openTurn.rows[0].office_time),
      offset: String(openTurn.rows[0].offset)
    };
  }
  const lastCheck = await ctx.store.pool.query(
    'SELECT credential_health FROM breach_checks WHERE feed_ok = true ORDER BY ran_at DESC LIMIT 1'
  );
  const healthMap: Record<string, string> = lastCheck.rows.length > 0 ? (lastCheck.rows[0].credential_health as Record<string, string>) : {};
  const storedHealth = healthMap[credentialId];
  const health =
    storedHealth === 'exposed'
      ? 'exposed'
      : storedHealth === 'vendor_breached'
        ? 'vendor_breached'
        : lastCheck.rows.length === 0
          ? 'not_checked'
          : policy.out_of_policy
            ? 'out_of_policy'
            : 'sound';
  return {
    id: credentialId,
    vault_id: vaultId,
    vendor: {
      id: String(row.vendor_id),
      name: String(row.vendor_name),
      domain: String(row.vendor_domain),
      formerly: row.vendor_formerly ? String(row.vendor_formerly) : null
    },
    label: String(row.label),
    username: String(row.username),
    held_by: holders.rows.map((holder) => ({
      person_id: String(holder.person_id),
      name: String(holder.full_name),
      left: Boolean(holder.is_left)
    })),
    next_turn: nextTurn,
    health,
    out_of_policy: policy.out_of_policy,
    out_of_policy_since: policy.out_of_policy_since,
    leeway_ends_at: policy.leeway_ends_at ? policy.leeway_ends_at.toISOString() : null,
    rule_id: rule?.id ?? null,
    last_turned_on: lastTurned
  };
}
