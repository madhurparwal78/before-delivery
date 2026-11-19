import { query } from '../db.js';
import { copy } from '../copy.js';
import { ApiError } from '../errors.js';
import { addOfficeDays, officeDate, officeMidnight, officeOffset, type OfficeDate } from '../officeTime.js';
import type { RuleRow, VaultRow } from '../types.js';

export async function loadRules(): Promise<RuleRow[]> {
  return query<RuleRow>('select * from rules order by effective_on asc, created_at asc');
}

export async function loadRule(id: string): Promise<RuleRow | null> {
  const rows = await query<RuleRow>('select * from rules where id = $1', [id]);
  return rows[0] ?? null;
}

export function rulesOfVault(rules: readonly RuleRow[], vaultId: string): RuleRow[] {
  return rules.filter((rule) => rule.vault_id === vaultId);
}

/**
 * The rule in force for a vault on an office date: the in-force or scheduled
 * rule with the latest effective date on or before it. Decided here only, so
 * every surface and every person reads the same rule.
 */
export function resolveRuleInForce(rules: readonly RuleRow[], onDate: OfficeDate): RuleRow | null {
  let chosen: RuleRow | null = null;
  for (const rule of rules) {
    if (rule.state !== 'in_force' && rule.state !== 'scheduled') continue;
    if (rule.effective_on > onDate) continue;
    if (
      chosen === null ||
      rule.effective_on > chosen.effective_on ||
      (rule.effective_on === chosen.effective_on && rule.created_at.getTime() > chosen.created_at.getTime())
    ) {
      chosen = rule;
    }
  }
  return chosen;
}

export function ruleInForceJson(rule: RuleRow): Record<string, unknown> {
  return { id: rule.id, min_length: rule.min_length, effective_on: rule.effective_on };
}

export function takesForceText(effectiveOn: OfficeDate): string {
  return copy.takesForce(officeOffset(officeMidnight(effectiveOn)), effectiveOn);
}

export function inForceFromText(effectiveOn: OfficeDate): string {
  return copy.inForceFrom(officeOffset(officeMidnight(effectiveOn)), effectiveOn);
}

export function draftStubText(rule: RuleRow): string {
  return copy.draftStub(rule.min_length, officeOffset(officeMidnight(rule.effective_on)), rule.effective_on);
}

export function stubTextFor(rule: RuleRow, today: OfficeDate): string | null {
  switch (rule.state) {
    case 'drafted':
      return draftStubText(rule);
    case 'scheduled':
      return takesForceText(rule.effective_on);
    case 'in_force':
      return rule.took_force_at !== null && officeDate(rule.took_force_at) === today
        ? inForceFromText(rule.effective_on)
        : null;
    case 'superseded':
      return null;
  }
}

export function ruleJson(rule: RuleRow, today: OfficeDate): Record<string, unknown> {
  return {
    id: rule.id,
    vault_id: rule.vault_id,
    min_length: rule.min_length,
    effective_on: rule.effective_on,
    state: rule.state,
    version: rule.version,
    drafted_by: rule.drafted_by,
    signed_by: rule.signed_by,
    stub_text: stubTextFor(rule, today),
  };
}

export function pendingRulesOf(rules: readonly RuleRow[], vaultId: string): RuleRow[] {
  return rulesOfVault(rules, vaultId)
    .filter((rule) => rule.state === 'drafted' || rule.state === 'scheduled')
    .sort((left, right) =>
      left.effective_on === right.effective_on
        ? left.created_at.getTime() - right.created_at.getTime()
        : left.effective_on < right.effective_on
          ? -1
          : 1,
    );
}

/** The next 60 office midnights, from tomorrow's midnight. */
export function asOfNights(today: OfficeDate): OfficeDate[] {
  return Array.from({ length: 60 }, (_, index) => addOfficeDays(today, index + 1));
}

export type AsOfVault = {
  vault_id: string;
  name: string;
  rule_in_force: Record<string, unknown> | null;
  cylinder: 'pending' | 'in_force';
  stubs: { rule_id: string; version: number; min_length: number; text: string; in_force: boolean }[];
  out_of_policy_count: number;
};

export function buildAsOf(options: {
  night: OfficeDate;
  today: OfficeDate;
  vaults: readonly VaultRow[];
  rules: readonly RuleRow[];
  secretLengths: ReadonlyMap<string, number[]>;
}): { vaults: AsOfVault[]; total: number } {
  const { night, today, vaults, rules, secretLengths } = options;
  const built: AsOfVault[] = [];
  let total = 0;
  for (const vault of vaults) {
    const ownRules = rulesOfVault(rules, vault.id);
    const inForce = resolveRuleInForce(ownRules, night);
    const minLength = inForce === null ? 0 : inForce.min_length;
    const lengths = secretLengths.get(vault.id) ?? [];
    const outOfPolicy = lengths.filter((length) => length < minLength).length;
    total += outOfPolicy;
    const stubs = ownRules
      .filter(
        (rule) =>
          rule.state === 'scheduled' ||
          (rule.state === 'in_force' && rule.took_force_at !== null && officeDate(rule.took_force_at) === today),
      )
      .sort((left, right) => (left.effective_on < right.effective_on ? -1 : left.effective_on > right.effective_on ? 1 : 0))
      .map((rule) => ({
        rule_id: rule.id,
        version: rule.version,
        min_length: rule.min_length,
        text: night < rule.effective_on ? takesForceText(rule.effective_on) : inForceFromText(rule.effective_on),
        in_force: night >= rule.effective_on,
      }));
    built.push({
      vault_id: vault.id,
      name: displayName(vault),
      rule_in_force: inForce === null ? null : ruleInForceJson(inForce),
      cylinder: ownRules.some((rule) => rule.state === 'scheduled' && rule.effective_on > night) ? 'pending' : 'in_force',
      stubs,
      out_of_policy_count: outOfPolicy,
    });
  }
  return { vaults: built, total };
}

export function displayName(named: { name: string; formerly: string | null }): string {
  return named.formerly === null ? named.name : `${named.name} (formerly ${named.formerly})`;
}

/** The published 409 order for a rule edit or signature. */
export function guardRuleState(rule: RuleRow, forSignature: boolean): void {
  if (rule.state === 'in_force') throw new ApiError(409, 'rule_in_force', copy.ruleNotSignable);
  if (rule.state === 'superseded') throw new ApiError(409, 'rule_superseded', copy.ruleNotSignable);
  if (forSignature && rule.state !== 'drafted') throw new ApiError(409, 'not_a_draft', copy.ruleNotSignable);
}

export function guardRuleVersion(rule: RuleRow, version: unknown): void {
  if (typeof version !== 'number' || !Number.isInteger(version)) return;
  if (version !== rule.version) throw new ApiError(409, 'rule_changed', copy.ruleChanged);
}
