import { one, query } from './db.js';
import type { Layout } from './domain/layout.js';
import type { AssetKind, Measures, MeasureKey, Rank } from './domain/ranks.js';

export interface AssetRow {
  id: string;
  world_id: string;
  kind: AssetKind;
  name: string;
  owner_id: string;
  last_version: number;
  removed: boolean;
  created_at: Date;
}

export interface VersionRow {
  asset_id: string;
  version: number;
  status: 'checked' | 'published';
  rank: Rank;
  worst_measure: MeasureKey;
  measures: Measures;
  layout: Layout | null;
  created_at: Date;
}

export async function getAsset(id: string): Promise<AssetRow | null> {
  return one<AssetRow>('select * from assets where id = $1 and removed = false', [id]);
}

export async function getVersion(assetId: string, version: number): Promise<VersionRow | null> {
  return one<VersionRow>('select * from asset_versions where asset_id = $1 and version = $2', [assetId, version]);
}

export async function currentPublishedVersion(assetId: string): Promise<VersionRow | null> {
  return one<VersionRow>(
    `select * from asset_versions where asset_id = $1 and status = 'published' order by version desc limit 1`,
    [assetId]
  );
}

export async function avatarRanks(personIds: string[]): Promise<Map<string, Rank | null>> {
  const ranks = new Map<string, Rank | null>();
  if (personIds.length === 0) return ranks;
  const rows = await query<{ id: string; rank: Rank | null }>(
    `select p.id,
            (select v.rank from asset_versions v
              where v.asset_id = p.avatar_asset_id and v.status = 'published'
              order by v.version desc limit 1) as rank
       from people p where p.id = any($1)`,
    [personIds]
  );
  for (const row of rows) ranks.set(row.id, row.rank);
  return ranks;
}
