import { Asset } from '../../shared/assets';
import { query, queryOne } from '../db/pool';
import { WorkspaceRecord } from '../http/runtime';

interface WorkspaceRow {
  slug: string;
  name: string;
  legal_name: string;
  lei: string;
  jurisdiction_code: string;
  time_zone: string;
  city: string;
  currency: string;
  confirmation_limit_cents: string;
  case_prefix: string;
  sending_address: string;
}

function toWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return {
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    lei: row.lei,
    jurisdictionCode: row.jurisdiction_code,
    timeZone: row.time_zone,
    city: row.city,
    currency: row.currency,
    confirmationLimitCents: BigInt(row.confirmation_limit_cents),
    casePrefix: row.case_prefix,
    sendingAddress: row.sending_address,
  };
}

export async function findWorkspace(slug: string): Promise<WorkspaceRecord | null> {
  const row = await queryOne<WorkspaceRow>('SELECT * FROM workspaces WHERE slug = $1', [slug]);
  return row === null ? null : toWorkspace(row);
}

export interface RuleInForce {
  readonly thresholdCents: bigint;
  readonly since: string;
}

/** The threshold rule in force for a jurisdiction in a workspace's rule book. */
export async function ruleInForceAt(
  workspaceSlug: string,
  jurisdictionCode: string,
  at: Date,
): Promise<RuleInForce | null> {
  const row = await queryOne<{ threshold_cents: string; takes_effect_on: string }>(
    `SELECT threshold_cents, takes_effect_on FROM threshold_changes
     WHERE workspace_slug = $1 AND jurisdiction_code = $2 AND takes_effect_at <= $3
     ORDER BY takes_effect_at DESC, takes_effect_on DESC LIMIT 1`,
    [workspaceSlug, jurisdictionCode, at],
  );
  return row === null
    ? null
    : { thresholdCents: BigInt(row.threshold_cents), since: row.takes_effect_on };
}

export async function rateInForce(workspaceSlug: string, asset: Asset): Promise<bigint> {
  const row = await queryOne<{ rate_cents: string }>(
    'SELECT rate_cents FROM rates WHERE workspace_slug = $1 AND asset = $2',
    [workspaceSlug, asset],
  );
  if (row === null) throw new Error(`No rate for ${asset}`);
  return BigInt(row.rate_cents);
}

export interface JurisdictionRow {
  code: string;
  name: string;
  region: string;
  currency: string;
  reference_status: string;
  reference_threshold_cents: string | null;
  reference_in_force_since: string | null;
  reference_change_threshold_cents: string | null;
  reference_change_takes_effect_on: string | null;
  sort_order: number;
}

export async function allJurisdictions(): Promise<JurisdictionRow[]> {
  return query<JurisdictionRow>('SELECT * FROM jurisdictions ORDER BY sort_order');
}

export async function findJurisdiction(code: string): Promise<JurisdictionRow | null> {
  return queryOne<JurisdictionRow>('SELECT * FROM jurisdictions WHERE code = $1', [code]);
}

export async function nextCaseReference(workspaceSlug: string): Promise<string> {
  const row = await queryOne<{ case_prefix: string; case_counter: number }>(
    'UPDATE workspaces SET case_counter = case_counter + 1 WHERE slug = $1 RETURNING case_prefix, case_counter',
    [workspaceSlug],
  );
  if (row === null) throw new Error(`No workspace ${workspaceSlug}`);
  return `${row.case_prefix}${row.case_counter.toString().padStart(6, '0')}`;
}
