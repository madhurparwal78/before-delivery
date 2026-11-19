import type { Pool } from 'pg';
import {
  addDays,
  officeDateString,
  officeMidnightInstant,
  parseOfficeDate,
  midnightOffset,
  formatOfficeDate
} from '../officeTime.js';
import type { ServerClock } from '../clock.js';


export interface RuleRow {
  id: string;
  vault_id: string;
  min_length: number;
  effective_on: string;
  state: 'drafted' | 'scheduled' | 'in_force' | 'superseded';
  version: number;
  drafted_by: string;
  signed_by: string | null;
}

export interface RuleInForce {
  id: string;
  min_length: number;
  effective_on: string;
}

/**
 * The one place a rule in force is decided: the in-force or scheduled rule for a
 * vault with the latest `effective_on` on or before the instant's office date.
 */
export function ruleInForceAt(rules: RuleRow[], vaultId: string, officeDate: string): RuleInForce | null {
  const candidates = rules.filter(
    (rule) =>
      rule.vault_id === vaultId &&
      (rule.state === 'in_force' || rule.state === 'scheduled') &&
      rule.effective_on <= officeDate
  );
  candidates.sort((a, b) => (a.effective_on === b.effective_on ? a.id.localeCompare(b.id) : a.effective_on < b.effective_on ? 1 : -1));
  const winner = candidates[0];
  return winner ? { id: winner.id, min_length: winner.min_length, effective_on: winner.effective_on } : null;
}

/** Whether an office midnight is among the next 60 office midnights. */
export function isNext60Midnight(dateStr: string, now: Date): boolean {
  const today = officeDateString(now);
  for (let i = 1; i <= 60; i++) {
    if (addDays(today, i) === dateStr) return true;
  }
  return false;
}

export interface AsOfVault {
  vault_id: string;
  name: string;
  rule_in_force: RuleInForce | null;
  cylinder: 'pending' | 'in_force';
  stubs: Array<{ rule_id: string; version: number; min_length: number; text: string; in_force: boolean }>;
  out_of_policy_count: number;
}

export interface AsOfAnswer {
  night: string;
  offset: string;
  starts_at: string;
  out_of_policy_count: number;
  vaults: AsOfVault[];
}

export interface CredentialPolicyRow {
  id: string;
  vault_id: string;
  secret_fingerprint: string;
  last_turned_on: string | null;
  out_of_policy_since: string | null;
}

/** The office date an office day number belongs to (used to render months). */
export function midnightList(now: Date): string[] {
  const today = officeDateString(now);
  const out: string[] = [];
  for (let i = 1; i <= 60; i++) out.push(addDays(today, i));
  return out;
}

/** Stub copy for a scheduled rule on a chosen night. */
export function stubText(rule: RuleRow, night: string): string {
  if (night < rule.effective_on) {
    return `Takes force 00:00 ${midnightOffset(rule.effective_on)}, ${formatOfficeDate(rule.effective_on)}`;
  }
  return `In force from 00:00 ${midnightOffset(rule.effective_on)}, ${formatOfficeDate(rule.effective_on)}`;
}

/** Draft stub copy; does not change with the night ruler. */
export function draftStubText(rule: RuleRow): string {
  return `Draft, waiting for the managing partner's signature: at least ${rule.min_length} characters from 00:00 ${midnightOffset(rule.effective_on)}, ${formatOfficeDate(rule.effective_on)}`;
}

/** In-force stub copy for the office day a rule took force. */
export function inForceStubText(rule: RuleRow): string {
  return `In force from 00:00 ${midnightOffset(rule.effective_on)}, ${formatOfficeDate(rule.effective_on)}`;
}

/** A vault's leeway end: 00:00 office time fourteen office days after the out-of-policy date. */
export function leewayEndsAt(outOfPolicySince: string): Date {
  return officeMidnightInstant(addDays(outOfPolicySince, 14));
}

export interface PolicyView {
  out_of_policy: boolean;
  out_of_policy_since: string | null;
  leeway_ends_at: Date | null;
}

/**
 * Out of policy: a login's secret is shorter than the rule in force's minimum.
 * `out_of_policy_since` is the later of the rule's effective date, the import
 * date, and the date it was last out of policy under this rule.
 */
export function policyView(
  rule: RuleInForce | null,
  secretLength: number,
  lastTurnedOn: string | null,
  storedSince: string | null,
  officeDate: string
): PolicyView {
  if (!rule || secretLength >= rule.min_length) {
    return { out_of_policy: false, out_of_policy_since: null, leeway_ends_at: null };
  }
  const sinceCandidates = [rule.effective_on];
  if (lastTurnedOn) sinceCandidates.push(lastTurnedOn);
  if (storedSince) sinceCandidates.push(storedSince);
  const since = sinceCandidates.reduce((max, value) => (value > max ? value : max), sinceCandidates[0]);
  const boundedSince = since > officeDate ? officeDate : since;
  return { out_of_policy: true, out_of_policy_since: boundedSince, leeway_ends_at: leewayEndsAt(boundedSince) };
}
