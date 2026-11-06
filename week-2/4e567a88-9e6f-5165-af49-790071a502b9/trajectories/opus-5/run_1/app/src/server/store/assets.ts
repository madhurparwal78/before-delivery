import { Queryable, big, db } from '../db';
import { AssetRecord } from '../types';

interface AssetDbRow {
  id: string;
  num: string;
  team_id: string;
  kind: string;
  media_type: string;
  job_id: string | null;
  model_slug: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  bytes: string;
  created_at: Date;
  expires_at: Date;
  storage_key: string;
  prompt: string | null;
  owner_member_id: string;
  removed_at: Date | null;
  removed_reason: string | null;
}

const COLUMNS = `id, num, team_id, kind, media_type, job_id, model_slug, width, height, duration_seconds, bytes,
  created_at, expires_at, storage_key, prompt, owner_member_id, removed_at, removed_reason`;

function toAsset(row: AssetDbRow): AssetRecord {
  return {
    id: row.id,
    num: big(row.num),
    teamId: row.team_id,
    kind: row.kind as 'upload' | 'output',
    mediaType: row.media_type,
    jobId: row.job_id,
    modelSlug: row.model_slug,
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    bytes: big(row.bytes),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    storageKey: row.storage_key,
    prompt: row.prompt,
    ownerMemberId: row.owner_member_id,
    removedAt: row.removed_at,
    removedReason: row.removed_reason as 'deleted' | 'expired' | null,
  };
}

export interface NewAsset {
  teamId: string;
  kind: 'upload' | 'output';
  mediaType: string;
  jobId: string | null;
  modelSlug: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number;
  expiresAt: Date;
  storageKeyFor: (assetId: string) => string;
  prompt: string | null;
  ownerMemberId: string;
  outputIndex: number | null;
  createdAt?: Date;
}

export async function insertAsset(client: Queryable, input: NewAsset): Promise<AssetRecord> {
  const { rows: sequence } = await client.query<{ value: string }>(`SELECT nextval('asset_seq')::text AS value`);
  const num = sequence[0]!.value;
  const id = `a_${num}`;
  const { rows } = await client.query<AssetDbRow>(
    `INSERT INTO assets (id, num, team_id, kind, media_type, job_id, model_slug, width, height, duration_seconds,
       bytes, created_at, expires_at, storage_key, prompt, owner_member_id, output_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($17, now()), $12, $13, $14, $15, $16)
     RETURNING ${COLUMNS}`,
    [
      id,
      num,
      input.teamId,
      input.kind,
      input.mediaType,
      input.jobId,
      input.modelSlug,
      input.width,
      input.height,
      input.durationSeconds,
      String(input.bytes),
      input.expiresAt,
      input.storageKeyFor(id),
      input.prompt,
      input.ownerMemberId,
      input.outputIndex,
      input.createdAt ?? null,
    ],
  );
  return toAsset(rows[0]!);
}

export async function assetById(id: string, client: Queryable = db): Promise<AssetRecord | null> {
  const { rows } = await client.query<AssetDbRow>(`SELECT ${COLUMNS} FROM assets WHERE id = $1`, [id]);
  return rows[0] ? toAsset(rows[0]) : null;
}

export async function assetsByIds(ids: readonly string[]): Promise<AssetRecord[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<AssetDbRow>(`SELECT ${COLUMNS} FROM assets WHERE id = ANY($1) ORDER BY num`, [ids]);
  return rows.map(toAsset);
}

export async function liveAssets(filter: {
  teamIds: readonly string[] | null;
  kind: string | null;
  modelSlug: string | null;
  limit: number;
}): Promise<AssetRecord[]> {
  const { rows } = await db.query<AssetDbRow>(
    `SELECT ${COLUMNS} FROM assets
      WHERE removed_at IS NULL AND expires_at > now()
        AND ($1::text[] IS NULL OR team_id = ANY($1))
        AND ($2::text IS NULL OR kind = $2)
        AND ($3::text IS NULL OR model_slug = $3)
      ORDER BY num DESC LIMIT $4`,
    [filter.teamIds === null ? null : [...filter.teamIds], filter.kind, filter.modelSlug, filter.limit],
  );
  return rows.map(toAsset);
}

export async function recentOutputsOfTeam(teamId: string, limit: number): Promise<AssetRecord[]> {
  const { rows } = await db.query<AssetDbRow>(
    `SELECT ${COLUMNS} FROM assets WHERE team_id = $1 AND kind = 'output' ORDER BY num DESC LIMIT $2`,
    [teamId, limit],
  );
  return rows.map(toAsset);
}

export async function markRemoved(
  client: Queryable,
  assetId: string,
  reason: 'deleted' | 'expired',
  at: Date,
): Promise<void> {
  await client.query(
    'UPDATE assets SET removed_at = $2, removed_reason = $3 WHERE id = $1 AND removed_at IS NULL',
    [assetId, at, reason],
  );
}

export async function expiredLiveAssets(): Promise<AssetRecord[]> {
  const { rows } = await db.query<AssetDbRow>(
    `SELECT ${COLUMNS} FROM assets WHERE removed_at IS NULL AND expires_at <= now()`,
  );
  return rows.map(toAsset);
}

export async function addEdge(client: Queryable, fromAssetId: string, toAssetId: string): Promise<void> {
  await client.query(
    'INSERT INTO asset_edges (from_asset_id, to_asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [fromAssetId, toAssetId],
  );
}

export interface Edge {
  from: string;
  to: string;
}

export async function edgesTouching(assetIds: readonly string[]): Promise<Edge[]> {
  if (assetIds.length === 0) return [];
  const { rows } = await db.query<{ from_asset_id: string; to_asset_id: string }>(
    'SELECT from_asset_id, to_asset_id FROM asset_edges WHERE from_asset_id = ANY($1) OR to_asset_id = ANY($1)',
    [[...assetIds]],
  );
  return rows.map((row) => ({ from: row.from_asset_id, to: row.to_asset_id }));
}

export async function allEdges(): Promise<Edge[]> {
  const { rows } = await db.query<{ from_asset_id: string; to_asset_id: string }>(
    'SELECT from_asset_id, to_asset_id FROM asset_edges',
  );
  return rows.map((row) => ({ from: row.from_asset_id, to: row.to_asset_id }));
}

export function isGone(asset: AssetRecord, now: Date): { gone: boolean; reason: 'deleted' | 'expired'; removedAt: Date } {
  if (asset.removedAt) {
    return { gone: true, reason: asset.removedReason ?? 'deleted', removedAt: asset.removedAt };
  }
  if (asset.expiresAt.getTime() <= now.getTime()) {
    return { gone: true, reason: 'expired', removedAt: asset.expiresAt };
  }
  return { gone: false, reason: 'deleted', removedAt: asset.expiresAt };
}
