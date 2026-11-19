import type { Db } from "./db.js";
import type { RuleRow } from "./model.js";
import { now } from "./clock.js";
import { addDays, officeDate, officeDateText, officeMidnight, offsetAt } from "./office-time.js";

export const MIN_LENGTH_FLOOR = 8;
export const MIN_LENGTH_CEILING = 64;

function stampOf(effectiveOn: string): string {
  return `00:00 ${offsetAt(officeMidnight(effectiveOn))}, ${officeDateText(effectiveOn)}`;
}

export const takesForceText = (effectiveOn: string): string => `Takes force ${stampOf(effectiveOn)}`;
export const inForceText = (effectiveOn: string): string => `In force from ${stampOf(effectiveOn)}`;
const draftText = (minLength: number, effectiveOn: string): string =>
  `Draft, waiting for the managing partner's signature: at least ${minLength} characters from ${stampOf(effectiveOn)}`;

function stubText(rule: RuleRow, today: string): string | null {
  switch (rule.state) {
    case "drafted":
      return draftText(rule.min_length, rule.effective_on);
    case "scheduled":
      return takesForceText(rule.effective_on);
    case "in_force":
      return rule.took_force_on === today ? inForceText(rule.effective_on) : null;
    case "superseded":
      return null;
  }
}

export function ruleView(rule: RuleRow, today: string): Record<string, unknown> {
  return {
    id: rule.id,
    vault_id: rule.vault_id,
    min_length: rule.min_length,
    effective_on: rule.effective_on,
    state: rule.state,
    version: rule.version,
    drafted_by: rule.drafted_by,
    signed_by: rule.signed_by,
    stub_text: stubText(rule, today),
  };
}

export const ruleBrief = (rule: RuleRow): { id: string; min_length: number; effective_on: string } => ({
  id: rule.id,
  min_length: rule.min_length,
  effective_on: rule.effective_on,
});

/**
 * The one decision of which rule is in force on an office date: among the in-force and scheduled rules,
 * the one with the latest effective date on or before that date.
 */
export function ruleInForce(rules: RuleRow[], date: string): RuleRow {
  let best: RuleRow | null = null;
  for (const rule of rules) {
    if (rule.state !== "in_force" && rule.state !== "scheduled") continue;
    if (rule.effective_on > date) continue;
    if (!best || rule.effective_on > best.effective_on) best = rule;
  }
  if (!best) throw new Error("a vault has no rule in force");
  return best;
}

/**
 * A scheduled rule whose office midnight has come reads as in force at once, and the rule it replaces as
 * superseded, so no reader sees a stale state between the midnight and the scheduler's own transition.
 */
function settleStates(rules: RuleRow[], today: string): RuleRow[] {
  const latest = ruleInForce(rules, today);
  return rules.map((rule) => {
    if (rule.state === "scheduled" && rule.effective_on <= today) {
      return { ...rule, state: "in_force", took_force_on: rule.effective_on };
    }
    if (rule.state === "in_force" && rule.id !== latest.id) return { ...rule, state: "superseded" };
    return rule;
  });
}

export async function rulesByVault(db: Db): Promise<Map<string, RuleRow[]>> {
  const rows = await db.query<RuleRow>("SELECT * FROM rules ORDER BY effective_on, ord");
  const grouped = new Map<string, RuleRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.vault_id) ?? [];
    list.push(row);
    grouped.set(row.vault_id, list);
  }
  const today = officeDate(now());
  for (const [vaultId, list] of grouped) grouped.set(vaultId, settleStates(list, today));
  return grouped;
}

/** The leeway after which a login that is out of policy cannot be revealed or copied. */
const LEEWAY_DAYS = 14;

export function outOfPolicyState(
  secretLength: number,
  importedOn: string | null,
  rule: RuleRow,
): { outOfPolicy: boolean; since: string | null; leewayEndsAt: Date | null } {
  if (secretLength >= rule.min_length) return { outOfPolicy: false, since: null, leewayEndsAt: null };
  const since = importedOn && importedOn > rule.effective_on ? importedOn : rule.effective_on;
  return { outOfPolicy: true, since, leewayEndsAt: officeMidnight(addDays(since, LEEWAY_DAYS)) };
}

/** One rule as readers see it (states settled against the office date), or null. */
export async function findRule(db: Db, id: string): Promise<RuleRow | null> {
  const row = await db.one<RuleRow>("SELECT vault_id FROM rules WHERE id = $1", [id]);
  return row ? ((await rulesByVault(db)).get(row.vault_id) ?? []).find((rule) => rule.id === id) ?? null : null;
}
