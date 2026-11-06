import { db } from '../db';
import { signedGetUrl } from '../services/s3';
import { assetsByIds, edgesTouching, isGone } from '../store/assets';
import { AssetRecord, JsonObject, JsonValue, Member, Policy } from '../types';
import { AssetAccess, assetAccessFor, payloadVisibleTo, projectAsset } from './projection';

interface Producer {
  submittedBy: string;
  teamId: string;
}

async function producersOf(assets: readonly AssetRecord[]): Promise<Map<string, Producer>> {
  const jobIds = assets.map((asset) => asset.jobId).filter((id): id is string => id !== null);
  const producers = new Map<string, Producer>();
  if (jobIds.length === 0) return producers;
  const { rows } = await db.query<{ id: string; submitted_by: string; team_id: string }>(
    'SELECT id, submitted_by, team_id FROM jobs WHERE id = ANY($1)',
    [[...new Set(jobIds)]],
  );
  for (const row of rows) producers.set(row.id, { submittedBy: row.submitted_by, teamId: row.team_id });
  return producers;
}

function promptVisible(asset: AssetRecord, producer: Producer | undefined, reader: Member, policy: Policy): boolean {
  if (!producer) return asset.ownerMemberId === reader.id || assetAccessFor(asset, reader, policy) === 'full';
  return payloadVisibleTo({ teamId: producer.teamId, submittedBy: producer.submittedBy }, reader, policy);
}

async function derivedFromOf(assetIds: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (assetIds.length === 0) return map;
  const { rows } = await db.query<{ from_asset_id: string; to_asset_id: string }>(
    `SELECT e.from_asset_id, e.to_asset_id FROM asset_edges e JOIN assets a ON a.id = e.from_asset_id
      WHERE e.to_asset_id = ANY($1) ORDER BY a.num`,
    [[...assetIds]],
  );
  for (const row of rows) {
    const list = map.get(row.to_asset_id) ?? [];
    list.push(row.from_asset_id);
    map.set(row.to_asset_id, list);
  }
  return map;
}

export interface AssetView {
  asset: AssetRecord;
  access: AssetAccess;
  json: JsonObject;
}

export async function assetViews(
  assets: readonly AssetRecord[],
  reader: Member,
  policy: Policy,
): Promise<AssetView[]> {
  const producers = await producersOf(assets);
  const derived = await derivedFromOf(assets.map((asset) => asset.id));
  const views: AssetView[] = [];
  for (const asset of assets) {
    const access = assetAccessFor(asset, reader, policy);
    if (access === 'hidden') continue;
    const producer = asset.jobId === null ? undefined : producers.get(asset.jobId);
    const payloadVisible = promptVisible(asset, producer, reader, policy);
    views.push({
      asset,
      access,
      json: projectAsset({ asset, access, payloadVisible, derivedFrom: derived.get(asset.id) ?? [] }),
    });
  }
  return views;
}

export async function singleAssetView(
  asset: AssetRecord,
  reader: Member,
  policy: Policy,
): Promise<AssetView | null> {
  const [view] = await assetViews([asset], reader, policy);
  return view ?? null;
}

function words(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);
}

export interface SearchableAsset {
  view: AssetView;
  modelName: string | null;
}

/** Each word of the query must appear in the model name, model slug, asset id or visible prompt. */
export function matchesSearch(candidate: SearchableAsset, query: string): boolean {
  const terms = words(query);
  if (terms.length === 0) return true;
  const prompt = typeof candidate.view.json['prompt'] === 'string' ? (candidate.view.json['prompt'] as string) : '';
  const haystack = [
    candidate.modelName ?? '',
    candidate.view.asset.modelSlug ?? '',
    candidate.view.asset.id,
    prompt,
  ]
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export interface LineageResult {
  nodes: JsonValue[];
  edges: { from: string; to: string }[];
}

/** Every asset reachable from one asset by visible "derived from" edges, in either direction. */
export async function lineageOf(startId: string, reader: Member, policy: Policy, now: Date): Promise<LineageResult> {
  const visited = new Set<string>([startId]);
  const frontier = [startId];
  const visibleEdges: { from: string; to: string }[] = [];
  const seenEdges = new Set<string>();

  while (frontier.length > 0) {
    const batch = frontier.splice(0, frontier.length);
    const edges = await edgesTouching(batch);
    const touchedIds = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))];
    const touched = await assetsByIds(touchedIds);
    const byId = new Map(touched.map((asset) => [asset.id, asset]));
    const producers = await producersOf(touched);
    for (const edge of edges) {
      const output = byId.get(edge.to);
      if (!output) continue;
      const producer = output.jobId === null ? undefined : producers.get(output.jobId);
      const edgeVisible = producer
        ? payloadVisibleTo({ teamId: producer.teamId, submittedBy: producer.submittedBy }, reader, policy)
        : false;
      if (!edgeVisible) continue;
      const key = `${edge.from}->${edge.to}`;
      if (!seenEdges.has(key)) {
        seenEdges.add(key);
        visibleEdges.push(edge);
      }
      for (const id of [edge.from, edge.to]) {
        if (!visited.has(id)) {
          visited.add(id);
          frontier.push(id);
        }
      }
    }
  }

  const assets = await assetsByIds([...visited]);
  const producers = await producersOf(assets);
  const ordered = [...assets].sort((a, b) => {
    const byTime = a.createdAt.getTime() - b.createdAt.getTime();
    if (byTime !== 0) return byTime;
    return Number(a.num - b.num);
  });
  const positions = new Map(ordered.map((asset, index) => [asset.id, index]));
  const nodes: JsonValue[] = ordered.map((asset) => {
    const state = isGone(asset, now);
    if (state.gone) {
      return {
        id: asset.id,
        state: 'tombstone',
        removed_at: state.removedAt.toISOString(),
        reason: state.reason,
      };
    }
    const producer = asset.jobId === null ? undefined : producers.get(asset.jobId);
    const payloadVisible = promptVisible(asset, producer, reader, policy);
    const access = assetAccessFor(asset, reader, policy);
    const node: JsonObject = {
      id: asset.id,
      state: 'live',
      media_type: asset.mediaType,
      model: asset.modelSlug,
      job_id: asset.jobId,
      created_at: asset.createdAt.toISOString(),
      thumbnail_url:
        asset.mediaType.startsWith('image/') && access === 'full' ? signedGetUrl(asset.storageKey) : null,
    };
    if (payloadVisible) node['prompt'] = asset.prompt;
    return node;
  });
  const edges = visibleEdges
    .filter((edge) => positions.has(edge.from) && positions.has(edge.to))
    .sort((a, b) => (positions.get(a.from)! - positions.get(b.from)!) || (positions.get(a.to)! - positions.get(b.to)!));
  return { nodes, edges };
}
