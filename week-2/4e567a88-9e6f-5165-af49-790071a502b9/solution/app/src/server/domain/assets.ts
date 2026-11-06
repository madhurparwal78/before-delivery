// Reading media: who may read an asset, its projection, search, lineage with tombstones.

import { config } from "../config";
import type { Db } from "../db";
import { rows } from "../db";
import { fail } from "../errors";
import { promptOf } from "../../shared/schema";
import { signedLink } from "../services/storage";
import type { Policy } from "./policy";
import {
  ASSET_SELECT, assetAccess, outputPayloadVisible, removal,
  type AssetAccess, type AssetRow, type Viewer,
} from "./visibility";

interface NewAsset {
  number: bigint;
  teamId: string;
  kind: "upload" | "output";
  mediaType: string;
  jobId: string | null;
  outputIndex: number | null;
  ownerId: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  bytes: number;
  objectKey: string;
}

/** Records a stored object as an asset; its expiry is stamped once, from the retention in force now. */
export async function insertAsset(db: Db, asset: NewAsset, policy: Policy, now: Date): Promise<string> {
  const id = `a_${asset.number}`;
  const expiresAt = new Date(now.getTime() + policy.retention_days * config.retentionDaySeconds * 1000);
  await db.query(
    `INSERT INTO assets (number, id, team_id, kind, media_type, job_id, output_index, owner_id, width, height,
       duration_seconds, bytes, object_key, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [asset.number, id, asset.teamId, asset.kind, asset.mediaType, asset.jobId, asset.outputIndex, asset.ownerId, asset.width,
      asset.height, asset.durationSeconds, asset.bytes, asset.objectKey, now, expiresAt]);
  return id;
}

export async function loadAssets(db: Db, where: string, params: unknown[], tail = ""): Promise<AssetRow[]> {
  return rows<AssetRow>(db, `${ASSET_SELECT} WHERE ${where} ${tail}`, params);
}

type Readable = { asset: AssetRow; access: Exclude<AssetAccess, "hidden"> };

/**
 * The asset as the caller may read it: 404 when unknown or hidden, then (after the caller's role check,
 * which `roleCheck` applies) 410 when deleted or expired.
 */
export async function readAsset(db: Db, viewer: Viewer, id: string, policy: Policy, now: Date, roleCheck?: () => void): Promise<Readable> {
  const [asset] = await loadAssets(db, "a.id = $1", [id]);
  if (!asset) fail("not_found");
  const access = assetAccess(viewer, asset, policy);
  if (access === "hidden") fail("not_found");
  roleCheck?.();
  const gone = removal(asset, now);
  if (gone) fail("asset_gone", { removed_at: gone.removed_at.toISOString(), reason: gone.reason });
  return { asset, access };
}

const outputPrompt = (asset: AssetRow): string | null => (asset.job_input ? promptOf(asset.job_input) : null);

async function derivedFrom(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  const edges = await rows<{ from_asset: string; to_asset: string }>(db,
    `SELECT e.from_asset, e.to_asset FROM asset_edges e JOIN assets f ON f.id = e.from_asset
     WHERE e.to_asset = ANY($1) ORDER BY f.number`, [ids]);
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.to_asset, [...(out.get(e.to_asset) ?? []), e.from_asset]);
  return out;
}

export async function projectAssets(db: Db, viewer: Viewer, policy: Policy, readable: Readable[]): Promise<Record<string, unknown>[]> {
  const edges = await derivedFrom(db, readable.map((r) => r.asset.id));
  return readable.map(({ asset, access }) => {
    const view: Record<string, unknown> = {
      id: asset.id,
      team_id: asset.team_id,
      kind: asset.kind,
      media_type: asset.media_type,
      job_id: asset.job_id,
      model: asset.model,
      width: asset.width,
      height: asset.height,
      duration_seconds: asset.duration_seconds,
      bytes: asset.bytes,
      created_at: asset.created_at.toISOString(),
      expires_at: asset.expires_at.toISOString(),
    };
    if (access === "full") view.url = signedLink(asset.object_key);
    if (outputPayloadVisible(viewer, asset, policy)) {
      view.prompt = outputPrompt(asset);
      view.derived_from = edges.get(asset.id) ?? [];
    }
    return view;
  });
}

interface SearchFilters {
  q: string;
  kind: string | null;
  model: string | null;
  team: string | null;
}

const SEARCH_LIMIT = 100;

/** Live assets the caller may see whose model name, slug, id or visible prompt holds every word of q. */
export async function searchAssets(db: Db, viewer: Viewer, policy: Policy, filters: SearchFilters, now: Date): Promise<Readable[]> {
  const candidates = await loadAssets(db,
    `a.removed_at IS NULL AND a.expires_at > $1 AND ($2::text IS NULL OR a.kind = $2)
     AND ($3::text IS NULL OR j.model = $3) AND ($4::text IS NULL OR a.team_id = $4)`,
    [now, filters.kind, filters.model, filters.team], "ORDER BY a.created_at DESC, a.number DESC");
  const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
  const found: Readable[] = [];
  for (const asset of candidates) {
    const access = assetAccess(viewer, asset, policy);
    if (access === "hidden") continue;
    const haystack = [asset.model_name, asset.model, asset.id, outputPayloadVisible(viewer, asset, policy) ? outputPrompt(asset) : null]
      .filter((part): part is string => Boolean(part)).join(" ").toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    found.push({ asset, access });
    if (found.length === SEARCH_LIMIT) break;
  }
  return found;
}

type LineageNode =
  | { id: string; state: "tombstone"; removed_at: string; reason: "deleted" | "expired" }
  | { id: string; state: "live"; media_type: string; model: string | null; job_id: string | null; created_at: string; thumbnail_url?: string; prompt?: string };

/**
 * The asset plus every asset reachable along "derived from" edges in either direction, using only edges
 * the caller may see (an edge into an output is visible when the producing job's payload is).
 */
export async function lineage(db: Db, viewer: Viewer, policy: Policy, start: AssetRow, now: Date):
Promise<{ nodes: LineageNode[]; edges: Array<{ from: string; to: string }> }> {
  const known = new Map<string, AssetRow>([[start.id, start]]);
  const edges = new Map<string, { from: string; to: string }>();
  const reached = new Set([start.id]);
  let frontier = [start.id];
  while (frontier.length) {
    const touching = await rows<{ from_asset: string; to_asset: string }>(db,
      "SELECT from_asset, to_asset FROM asset_edges WHERE from_asset = ANY($1) OR to_asset = ANY($1)", [frontier]);
    const missing = [...new Set(touching.flatMap((e) => [e.from_asset, e.to_asset]))].filter((id) => !known.has(id));
    for (const asset of missing.length ? await loadAssets(db, "a.id = ANY($1)", [missing]) : []) known.set(asset.id, asset);
    const next: string[] = [];
    for (const e of touching) {
      const key = `${e.from_asset}>${e.to_asset}`;
      const from = known.get(e.from_asset) as AssetRow;
      const to = known.get(e.to_asset) as AssetRow;
      const visible = outputPayloadVisible(viewer, to, policy)
        && assetAccess(viewer, from, policy) !== "hidden" && assetAccess(viewer, to, policy) !== "hidden";
      if (edges.has(key) || !visible) continue;
      edges.set(key, { from: e.from_asset, to: e.to_asset });
      for (const id of [e.from_asset, e.to_asset]) {
        if (!reached.has(id)) {
          reached.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }
  const members = [...reached]
    .map((id) => known.get(id) as AssetRow)
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || Number(a.number - b.number));
  const order = new Map(members.map((a, i) => [a.id, i]));
  const nodes = members.map((asset): LineageNode => {
    const gone = removal(asset, now);
    if (gone) return { id: asset.id, state: "tombstone", removed_at: gone.removed_at.toISOString(), reason: gone.reason };
    const node: LineageNode = {
      id: asset.id, state: "live", media_type: asset.media_type, model: asset.model, job_id: asset.job_id,
      created_at: asset.created_at.toISOString(),
    };
    if (asset.media_type.startsWith("image/") && assetAccess(viewer, asset, policy) === "full") node.thumbnail_url = signedLink(asset.object_key);
    if (outputPayloadVisible(viewer, asset, policy)) node.prompt = outputPrompt(asset) ?? "";
    return node;
  });
  const sorted = [...edges.values()].sort((a, b) =>
    (order.get(a.from) as number) - (order.get(b.from) as number) || (order.get(a.to) as number) - (order.get(b.to) as number));
  return { nodes, edges: sorted };
}
