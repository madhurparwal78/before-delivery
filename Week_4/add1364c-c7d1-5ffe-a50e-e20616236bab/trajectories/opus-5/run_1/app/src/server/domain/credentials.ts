import { query } from '../db.js';
import {
  addOfficeDays,
  officeDate,
  officeMidnight,
  officeOffset,
  officeTimeOfDay,
  type OfficeDate,
} from '../officeTime.js';
import type { CredentialRow, Health, RuleRow, TurnRow, VaultRow, VendorRow } from '../types.js';
import { displayName, resolveRuleInForce, rulesOfVault } from './rules.js';
import { nextRunAfter, type RotationRow } from './turns.js';

const LEEWAY_DAYS = 14;

export type HolderRow = { credential_id: string; person_id: string; full_name: string; left: boolean };

export type CheckHealthRow = { credential_id: string; exposed: boolean; vendor_breached: boolean };

export async function loadCredentials(vaultIds: readonly string[] | null): Promise<CredentialRow[]> {
  if (vaultIds === null) return query<CredentialRow>('select * from credentials order by order_no asc');
  if (vaultIds.length === 0) return [];
  return query<CredentialRow>('select * from credentials where vault_id = any($1::uuid[]) order by order_no asc', [
    vaultIds,
  ]);
}

export async function loadCredential(id: string): Promise<CredentialRow | null> {
  const rows = await query<CredentialRow>('select * from credentials where id = $1', [id]);
  return rows[0] ?? null;
}

export async function loadVendors(): Promise<VendorRow[]> {
  return query<VendorRow>('select * from vendors order by order_no asc');
}

export async function loadHolders(): Promise<HolderRow[]> {
  return query<HolderRow>(
    `select ch.credential_id, ch.person_id, p.full_name, (p.left_at is not null) as left
       from credential_holders ch join people p on p.id = ch.person_id
      order by p.order_no asc`,
  );
}

export async function loadOpenTurns(): Promise<TurnRow[]> {
  return query<TurnRow>("select * from turns where state in ('due','overdue') order by due_by asc, created_at asc");
}

export async function loadRotations(): Promise<RotationRow[]> {
  return query<RotationRow>('select * from rotations');
}

export async function latestGoodCheck(): Promise<{ id: string; at: Date } | null> {
  const rows = await query<{ id: string; at: Date }>(
    'select id, at from breach_checks where ok = true order by at desc limit 1',
  );
  return rows[0] ?? null;
}

export async function checkHealthRows(checkId: string): Promise<CheckHealthRow[]> {
  return query<CheckHealthRow>(
    'select credential_id, exposed, vendor_breached from breach_check_health where check_id = $1',
    [checkId],
  );
}

export type PolicyStand = {
  outOfPolicy: boolean;
  since: OfficeDate | null;
  leewayEndsAt: Date | null;
  ruleId: string | null;
  minLength: number;
};

/** A login's out-of-policy flag and leeway end, from the rule in force. */
export function policyStand(credential: CredentialRow, rule: RuleRow | null): PolicyStand {
  if (rule === null) return { outOfPolicy: false, since: null, leewayEndsAt: null, ruleId: null, minLength: 0 };
  if (credential.secret_length >= rule.min_length) {
    return { outOfPolicy: false, since: null, leewayEndsAt: null, ruleId: rule.id, minLength: rule.min_length };
  }
  const since = credential.secret_set_on > rule.effective_on ? credential.secret_set_on : rule.effective_on;
  return {
    outOfPolicy: true,
    since,
    leewayEndsAt: officeMidnight(addOfficeDays(since, LEEWAY_DAYS)),
    ruleId: rule.id,
    minLength: rule.min_length,
  };
}

export function healthOf(
  credential: CredentialRow,
  stand: PolicyStand,
  snapshot: ReadonlyMap<string, CheckHealthRow> | null,
): Health {
  if (snapshot === null) return 'not_checked';
  const row = snapshot.get(credential.id);
  if (row === undefined) return 'not_checked';
  if (row.exposed) return 'exposed';
  if (row.vendor_breached) return 'vendor_breached';
  return stand.outOfPolicy ? 'out_of_policy' : 'sound';
}

export type NextTurn = { office_date: OfficeDate; office_time: string; offset: string } | null;

export function nextTurnOf(
  credential: CredentialRow,
  openTurns: readonly TurnRow[],
  rotation: RotationRow | undefined,
  at: Date,
): NextTurn {
  const candidates: Date[] = [];
  for (const turn of openTurns) {
    if (turn.credential_id !== credential.id) continue;
    candidates.push(turn.run_at ?? officeMidnight(turn.due_by));
  }
  if (rotation !== undefined) {
    const run = nextRunAfter(rotation, at);
    if (run !== null) candidates.push(run.at);
  }
  if (candidates.length === 0) return null;
  const earliest = candidates.reduce((left, right) => (left.getTime() <= right.getTime() ? left : right));
  return {
    office_date: officeDate(earliest),
    office_time: officeTimeOfDay(earliest),
    offset: officeOffset(earliest),
  };
}

export type CredentialContext = {
  vaults: readonly VaultRow[];
  vendors: readonly VendorRow[];
  rules: readonly RuleRow[];
  holders: readonly HolderRow[];
  openTurns: readonly TurnRow[];
  rotations: readonly RotationRow[];
  snapshot: ReadonlyMap<string, CheckHealthRow> | null;
  at: Date;
};

export function credentialJson(credential: CredentialRow, context: CredentialContext): Record<string, unknown> {
  const vendor = context.vendors.find((entry) => entry.id === credential.vendor_id);
  const rule = resolveRuleInForce(rulesOfVault(context.rules, credential.vault_id), officeDate(context.at));
  const stand = policyStand(credential, rule);
  const rotation = context.rotations.find((entry) => entry.credential_id === credential.id);
  return {
    id: credential.id,
    vault_id: credential.vault_id,
    vendor:
      vendor === undefined
        ? null
        : { id: vendor.id, name: vendor.name, domain: vendor.domain, formerly: vendor.formerly },
    label: credential.label,
    username: credential.username,
    held_by: context.holders
      .filter((holder) => holder.credential_id === credential.id)
      .map((holder) => ({ person_id: holder.person_id, name: holder.full_name, left: holder.left })),
    next_turn: nextTurnOf(credential, context.openTurns, rotation, context.at),
    health: healthOf(credential, stand, context.snapshot),
    out_of_policy: stand.outOfPolicy,
    out_of_policy_since: stand.since,
    leeway_ends_at: stand.leewayEndsAt === null ? null : stand.leewayEndsAt.toISOString(),
    rule_id: stand.ruleId,
    last_turned_on: credential.last_turned_on,
  };
}

export function vendorDisplay(vendor: VendorRow): string {
  return displayName(vendor);
}
