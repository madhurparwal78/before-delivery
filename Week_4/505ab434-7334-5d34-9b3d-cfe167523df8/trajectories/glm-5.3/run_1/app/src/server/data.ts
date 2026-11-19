import type { Tx } from './db';
import { txQuery, query } from './db';
import { audienceOfRole, type Role } from '../shared/domain';
import type { ViewerContext, GrantRow, AssetRow, LicenceRow } from './availability';
import type { Principal } from './http';

export interface Viewer {
  principal: Principal;
  context: ViewerContext;
}

export async function loadViewer(principal: Principal): Promise<Viewer> {
  const org = await query<{
    territory: string;
    engagement_ends_on: string | null;
  }>(
    'SELECT territory, engagement_ends_on::text FROM organisations WHERE id = $1',
    [principal.organisationId],
  );
  const groups = await query<{ group_id: string }>(
    'SELECT gm.group_id FROM group_members gm WHERE gm.principal_id = $1',
    [principal.id],
  );
  const role = principal.role as Role;
  return {
    principal,
    context: {
      principalId: principal.id,
      role,
      audience: audienceOfRole(role),
      organisationTerritory: org[0]?.territory ?? '',
      groupIds: groups.map((g) => g.group_id),
      engagementEndsOn: org[0]?.engagement_ends_on ?? null,
    },
  };
}

export interface CardAsset {
  id: string;
  name: string;
  className: string;
  state: string;
  licenceId: string;
  successorId: string | null;
  successorName: string | null;
}

export async function loadCardAssets(): Promise<CardAsset[]> {
  return query<CardAsset & { licence_name: string }>(
    `SELECT a.id, a.name, a.class AS class_name, a.state, a.licence_id, a.successor_id,
            s.name AS successor_name, l.name AS licence_name
       FROM assets a
       JOIN licences l ON l.id = a.licence_id
       LEFT JOIN assets s ON s.id = a.successor_id
      WHERE a.state <> 'draft'
      ORDER BY a.name`,
  );
}

export async function loadLicence(id: string): Promise<LicenceRow> {
  const rows = await query<LicenceRow & { default_duration_days: number; name: string }>(
    'SELECT * FROM licences WHERE id = $1',
    [id],
  );
  if (rows.length === 0) throw new Error(`licence ${id} not found`);
  return rows[0];
}

export interface CardTarget {
  assetId: string;
  variantId: string | null;
  cardName: string;
  className: string;
  licenceId: string;
}

export async function cardTarget(assetId: string, variantId: string | null): Promise<CardTarget> {
  const rows = await query<{
    id: string;
    name: string;
    class_name: string;
    licence_id: string;
    state: string;
    variant_id: string | null;
    label: string | null;
  }>(
    `SELECT a.id, a.name, a.class AS class_name, a.licence_id, a.state,
            v.id AS variant_id, v.label
       FROM assets a LEFT JOIN variants v ON v.id = $2
      WHERE a.id = $1`,
    [assetId, variantId],
  );
  if (rows.length === 0) return notFound();
  const row = rows[0];
  if (variantId && row.variant_id !== variantId) return notFound();
  const cardName = variantId ? `${row.name} — ${row.label}` : row.name;
  return {
    assetId: row.id,
    variantId: row.variant_id,
    cardName,
    className: row.class_name,
    licenceId: row.licence_id,
  };
}

function notFound(): never {
  throw new Error('card target not found');
}

export async function grantsForCard(
  assetId: string,
  variantId: string | null,
): Promise<(GrantRow & { licenceId: string })[]> {
  const rows = await query<{
    id: string;
    holder_type: string;
    holder_principal_id: string | null;
    holder_group_id: string | null;
    status: string;
    not_before: string | null;
    not_after: string;
    licence_id: string;
  }>(
    `SELECT g.id, g.holder_type, g.holder_principal_id, g.holder_group_id, g.status,
            g.not_before::text, g.not_after::text, a.licence_id
       FROM grants g JOIN assets a ON a.id = g.asset_id
      WHERE g.asset_id = $1 AND (g.variant_id = $2 OR ($2 IS NULL AND g.variant_id IS NULL))`,
    [assetId, variantId],
  );
  return rows.map((row) => ({
    id: row.id,
    holderType: row.holder_type as 'principal' | 'group',
    holderPrincipalId: row.holder_principal_id,
    holderGroupId: row.holder_group_id,
    status: row.status,
    notBefore: row.not_before,
    notAfter: row.not_after,
    licenceId: row.licence_id,
  }));
}

export function implicitGrantApplies(licence: LicenceRow, viewer: Viewer): boolean {
  return licence.audiences.includes(viewer.context.audience) && viewer.context.role !== 'agency' && viewer.context.role !== 'press';
}

export interface AssetFull {
  id: string;
  name: string;
  state: string;
  successorName: string | null;
  licenceId: string;
  className: string;
  licence: LicenceRow;
}

export async function assetById(id: string): Promise<AssetFull | null> {
  const rows = await query<{
    id: string;
    name: string;
    state: string;
    successor_name: string | null;
    licence_id: string;
    class_name: string;
    permitted_applications: string[];
    prohibited_applications: string[];
    audiences: string[];
    territories: string[];
    excluded_territories: string[];
  }>(
    `SELECT a.id, a.name, a.state, s.name AS successor_name, a.licence_id, a.class AS class_name,
            l.permitted_applications, l.prohibited_applications, l.audiences, l.territories,
            l.excluded_territories
       FROM assets a
       JOIN licences l ON l.id = a.licence_id
       LEFT JOIN assets s ON s.id = a.successor_id
      WHERE a.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    successorName: row.successor_name,
    className: row.class_name,
    licenceId: row.licence_id,
    licence: {
      permittedApplications: row.permitted_applications,
      prohibitedApplications: row.prohibited_applications,
      audiences: row.audiences,
      territories: row.territories,
      excludedTerritories: row.excluded_territories,
    },
  };
}

export async function openRequestsFor(viewer: Viewer, assetId: string, variantId: string | null): Promise<{ id: string; state: string }[]> {
  return query<{ id: string; state: string }>(
    `SELECT id, state FROM requests
      WHERE requester_id = $1 AND asset_id = $2 AND (variant_id = $3 OR ($3 IS NULL AND variant_id IS NULL))
        AND state IN ('draft','routed','under_review','changes_requested')`,
    [viewer.principal.id, assetId, variantId],
  );
}

export async function pendingProofGrantsFor(viewer: Viewer, assetId: string, variantId: string | null): Promise<{ id: string }[]> {
  return query<{ id: string }>(
    `SELECT g.id FROM grants g
      WHERE ((g.holder_type = 'principal' AND g.holder_principal_id = $1)
          OR (g.holder_type = 'group' AND g.holder_group_id = ANY($2)))
        AND g.asset_id = $3 AND (g.variant_id = $4 OR ($4 IS NULL AND g.variant_id IS NULL))
        AND g.status = 'pending_proof'`,
    [viewer.principal.id, viewer.context.groupIds, assetId, variantId],
  );
}

export async function txOne<T extends Record<string, unknown>>(
  tx: Tx,
  sql: string,
  params: readonly unknown[],
): Promise<T | null> {
  const rows = await txQuery<T>(tx, sql, params);
  return rows.length > 0 ? rows[0] : null;
}
