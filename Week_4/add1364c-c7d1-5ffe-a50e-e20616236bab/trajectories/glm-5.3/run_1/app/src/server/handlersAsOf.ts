import type { Ctx } from './apiRoutes.js';
import { ApiError, invalid, notFound } from './errors.js';
import { jsonOk } from './http.js';
import { requireRole, loadVaults } from './handlersCore.js';
import { isNext60Midnight, ruleInForceAt, stubText, inForceStubText, type RuleRow } from './domain/rules.js';
import {
  addDays,
  midnightOffset,
  officeDateString,
  officeMidnightInstant,
  officeTimeString,
  offsetAbbreviation
} from './officeTime.js';

/**
 * The as-of drawer: for one of the next 60 office midnights, which rule is in
 * force in each vault, what the stub text is, and how many logins are out of policy.
 */
export async function getAsOf(ctx: Ctx): Promise<void> {
  requireRole(ctx, 'office_manager', 'managing_partner');
  const nightRaw = ctx.url.searchParams.get('night') ?? '';
  const now = ctx.store.clock.now();
  const today = officeDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nightRaw) || !isNext60Midnight(nightRaw, now)) {
    throw invalid({ night: 'Pick one of the next 60 office midnights.' });
  }
  const vaults = await loadVaults(ctx);
  const rules = await ctx.store.pool.query('SELECT * FROM rules');
  const allRules: RuleRow[] = rules.rows.map((row) => ({
    id: String(row.id),
    vault_id: String(row.vault_id),
    min_length: Number(row.min_length),
    effective_on: String(row.effective_on).slice(0, 10),
    state: row.state as RuleRow['state'],
    version: Number(row.version),
    drafted_by: String(row.drafted_by),
    signed_by: row.signed_by ? String(row.signed_by) : null
  }));
  const credentials = await ctx.store.pool.query(
    `SELECT c.id, c.vault_id, c.secret_enc, c.last_turned_on, c.out_of_policy_since, v.name AS vault_name
     FROM credentials c JOIN vaults v ON v.id = c.vault_id`
  );
  // secret lengths via the store's box
  const secretLengths = new Map<string, number>();
  for (const row of credentials.rows) {
    const enc = row.secret_enc as Buffer;
    secretLengths.set(String(row.id), ctx.store.secrets.decrypt(enc).length);
  }
  const vaultViews: Array<Record<string, unknown>> = [];
  let total = 0;
  for (const vault of vaults) {
    const ruleAt = ruleInForceAt(allRules, vault.id, nightRaw);
    const pending = allRules.find(
      (rule) => rule.vault_id === vault.id && rule.state === 'scheduled' && rule.effective_on > nightRaw
    );
    const cylinder: 'pending' | 'in_force' = pending ? 'pending' : 'in_force';
    const stubs: Array<{ rule_id: string; version: number; min_length: number; text: string; in_force: boolean }> = [];
    const todayMidnight = officeMidnightInstant(today);
    for (const rule of allRules) {
      if (rule.vault_id !== vault.id) continue;
      const isScheduled = rule.state === 'scheduled';
      const tookForceToday =
        rule.state === 'in_force' && rule.effective_on === today && now.getTime() >= todayMidnight.getTime();
      if (!isScheduled && !tookForceToday) continue;
      const inForce = nightRaw >= rule.effective_on;
      stubs.push({
        rule_id: rule.id,
        version: rule.version,
        min_length: rule.min_length,
        text: isScheduled ? stubText(rule, nightRaw) : inForceStubText(rule),
        in_force: inForce
      });
    }
    stubs.sort((a, b) => a.version - b.version);
    const count = credentials.rows.filter((row) => {
      if (String(row.vault_id) !== vault.id) return false;
      const length = secretLengths.get(String(row.id)) ?? 0;
      return ruleAt !== null && length < ruleAt.min_length;
    }).length;
    total += count;
    vaultViews.push({
      vault_id: vault.id,
      name: vault.name,
      rule_in_force: ruleAt,
      cylinder,
      stubs,
      out_of_policy_count: count
    });
  }
  jsonOk(ctx.res, 200, {
    night: nightRaw,
    offset: midnightOffset(nightRaw),
    starts_at: officeMidnightInstant(nightRaw).toISOString(),
    out_of_policy_count: total,
    vaults: vaultViews
  });
}
