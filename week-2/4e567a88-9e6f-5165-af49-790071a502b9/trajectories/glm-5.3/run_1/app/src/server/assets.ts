// Assets: uploads, media inputs, reads, search, lineage, deletion and retention.
import type { Pool, Tx } from "./db.js";
import type { AssetRow, MemberRow } from "./domain.js";
import { payloadVisibleTo } from "./domain.js";
import { ApiError } from "./jobs.js";
import type { Storage } from "./storage.js";
import type { Outbound } from "./outbound.js";
import type { Config } from "./config.js";

export const MAX_UPLOAD_BYTES = 10_000_000;
export const SIGNED_LINK_SECONDS = 300;

const EXT_FOR: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export interface AssetDeps {
  storage: Storage;
  outbound: Outbound;
  storageUp(): Promise<boolean>;
}

/** Whether the caller may read this asset (while it was live). */
export async function canReadAsset(
  pool: Pool,
  asset: { team_id: string; kind: string; uploaded_by: string | null; job_id: string | null },
  caller: MemberRow,
): Promise<boolean> {
  if (asset.kind === "upload") {
    if (caller.role === "admin" || caller.role === "compliance") return true;
    if (caller.team_id === asset.team_id) {
      if (caller.id === asset.uploaded_by) return true;
      const team = await pool.one<{ payload_visibility: string }>(`SELECT payload_visibility FROM teams WHERE id = $1`, [asset.team_id]);
      return (team?.payload_visibility ?? "team") === "team";
    }
    return false;
  }
  // Outputs: every signed-in role may read them; payload fields follow visibility.
  return true;
}

/** Whether the caller may see the producing job's payload for this output asset. */
export async function promptVisibleForAsset(pool: Pool, asset: { job_id: string | null; team_id: string }, caller: MemberRow): Promise<boolean> {
  if (!asset.job_id) return true;
  const job = await pool.one<{ team_id: string; submitted_by: string }>(
    `SELECT team_id, submitted_by FROM jobs WHERE id = $1`,
    [asset.job_id],
  );
  if (!job) return true;
  return payloadVisibleTo(pool, job, caller);
}

export function assetRow(r: Record<string, unknown>): AssetRow {
  return {
    id: r.id as string,
    team_id: r.team_id as string,
    kind: r.kind as AssetRow["kind"],
    media_type: r.media_type as string,
    job_id: (r.job_id as string | null) ?? null,
    model_slug: (r.model_slug as string | null) ?? null,
    width: (r.width as number | null) ?? null,
    height: (r.height as number | null) ?? null,
    duration_seconds: (r.duration_seconds as string | null) ?? null,
    bytes: Number(r.bytes ?? 0),
    created_at: r.created_at as Date,
    expires_at: r.expires_at as Date,
    object_key: r.object_key as string,
    state: r.state as AssetRow["state"],
    removed_at: (r.removed_at as Date | null) ?? null,
    removed_reason: (r.removed_reason as string | null) ?? null,
    uploaded_by: (r.uploaded_by as string | null) ?? null,
  };
}

/** Upload an image and record it as a live asset. */
export async function uploadAsset(
  pool: Pool,
  cfg: Config,
  deps: AssetDeps,
  teamId: string,
  uploader: MemberRow,
  body: Buffer,
  mediaType: string,
): Promise<AssetRow> {
  const ext = EXT_FOR[mediaType];
  if (!ext) throw new ApiError(415, "unsupported_media_type", "Use a PNG, JPEG or WebP image.");
  if (body.byteLength > MAX_UPLOAD_BYTES) throw new ApiError(413, "payload_too_large", "That file is larger than the upload limit.");
  if (!(await deps.storageUp())) {
    throw new ApiError(503, "storage_unavailable", "Storage is unreachable. Try the upload again when it returns.");
  }
  const now = new Date();
  const expires = await expiryFor(pool, cfg, now);
  const asset = await pool.tx(async (tx) => {
    const seq = await tx.one<{ nextval: number }>(`SELECT nextval('asset_seq') AS nextval`);
    const id = `a_${seq?.nextval}`;
    const key = `uploads/${teamId}/${id}.${ext}`;
    await tx.exec(
      `INSERT INTO assets (id, team_id, kind, media_type, bytes, created_at, expires_at, object_key, state, uploaded_by)
       VALUES ($1,$2,'upload',$3,$4,$5,$6,$7,'live',$8)`,
      [id, teamId, mediaType, body.byteLength, now, expires, key, uploader.id],
    );
    return { id, key };
  });
  try {
    await deps.storage.put(asset.key, body, mediaType);
  } catch (e) {
    await pool.exec(`DELETE FROM assets WHERE id = $1`, [asset.id]);
    throw new ApiError(503, "storage_unavailable", "Storage is unreachable. Try the upload again when it returns.");
  }
  const row = await pool.one<Record<string, unknown>>(`SELECT * FROM assets WHERE id = $1`, [asset.id]);
  return assetRow(row as Record<string, unknown>);
}

async function expiryFor(pool: Pool, cfg: Config, at: Date): Promise<Date> {
  const org = await pool.one<{ retention_days: number }>(`SELECT retention_days FROM orgs WHERE id = 'org'`);
  return new Date(at.getTime() + (org?.retention_days ?? 30) * cfg.retentionDaySeconds * 1000);
}

/** Fetch an image URL under the outbound rules and store it as an upload asset. */
export async function fetchImageAsAsset(
  pool: Pool,
  cfg: Config,
  deps: AssetDeps,
  url: string,
  teamId: string,
  uploader: MemberRow,
): Promise<{ assetId?: string; error?: string }> {
  try {
    const res = await deps.outbound.fetch({
      url,
      method: "GET",
      followRedirects: 3,
      maxBytes: MAX_UPLOAD_BYTES,
      timeoutMs: 10_000,
    });
    if (res.status < 200 || res.status >= 300) {
      return { error: "That image could not be fetched." };
    }
    const type = (Array.isArray(res.headers["content-type"]) ? res.headers["content-type"][0] : res.headers["content-type"]) ?? "";
    const base = type.split(";")[0].trim().toLowerCase();
    if (!EXT_FOR[base]) {
      return { error: "That address did not return a PNG, JPEG or WebP image." };
    }
    if (res.body.byteLength > MAX_UPLOAD_BYTES) {
      return { error: "That image is larger than the upload limit." };
    }
    const asset = await uploadAsset(pool, cfg, deps, teamId, uploader, res.body, base);
    return { assetId: asset.id };
  } catch (e) {
    if (eName(e) === "AddressRefusedError") return { error: "This address is not allowed. Use a public address." };
    if (eName(e) === "TooLargeError") return { error: "That image is larger than the upload limit." };
    return { error: "That image could not be fetched." };
  }
}

function eName(e: unknown): string {
  return typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
}

/** The asset with its signed url; 404 for callers who may not read it, 410 once gone. */
export async function readAsset(pool: Pool, id: string, caller: MemberRow): Promise<AssetRow> {
  const row = await pool.one<Record<string, unknown>>(`SELECT * FROM assets WHERE id = $1`, [id]);
  if (!row) throw new ApiError(404, "not_found", "That asset does not exist.");
  const asset = assetRow(row);
  const readable = await canReadAsset(pool, asset, caller);
  if (!readable) throw new ApiError(404, "not_found", "That asset does not exist.");
  if (asset.state !== "live") {
    throw new ApiError(410, "asset_gone", "That asset is already gone.", undefined, {
      removed_at: asset.removed_at,
      reason: asset.removed_reason,
    });
  }
  return asset;
}

/** Project an asset for a caller. */
export async function projectAsset(
  pool: Pool,
  deps: AssetDeps,
  asset: AssetRow,
  caller: MemberRow,
): Promise<Record<string, unknown>> {
  const visible = asset.kind === "output" ? await promptVisibleForAsset(pool, asset, caller) : await canReadAsset(pool, asset, caller);
  const out: Record<string, unknown> = {
    id: asset.id,
    team_id: asset.team_id,
    kind: asset.kind,
    media_type: asset.media_type,
    job_id: asset.job_id,
    model: asset.model_slug,
    width: asset.width,
    height: asset.height,
    duration_seconds: asset.duration_seconds === null ? null : Number(asset.duration_seconds),
    bytes: asset.bytes,
    created_at: iso(asset.created_at),
    expires_at: iso(asset.expires_at),
    url: deps.storage.presignGet(asset.object_key, SIGNED_LINK_SECONDS),
  };
  if (asset.kind === "output") {
    if (visible) {
      out.prompt = await promptOfAsset(pool, asset);
      out.derived_from = await derivedFrom(pool, asset);
    }
  }
  return out;
}

/** A restricted-team upload keeps its url from admins and compliance. */
export async function projectAssetRestrictedUpload(pool: Pool, deps: AssetDeps, asset: AssetRow, caller: MemberRow): Promise<Record<string, unknown>> {
  const base = await projectAsset(pool, deps, asset, caller);
  if (asset.kind === "upload" && caller.team_id !== asset.team_id && (caller.role === "admin" || caller.role === "compliance")) {
    const team = await pool.one<{ payload_visibility: string }>(`SELECT payload_visibility FROM teams WHERE id = $1`, [asset.team_id]);
    if ((team?.payload_visibility ?? "team") === "restricted" && asset.uploaded_by !== caller.id) {
      delete base.url;
    }
  }
  return base;
}

async function promptOfAsset(pool: Pool, asset: AssetRow): Promise<string | null> {
  if (!asset.job_id) return null;
  const job = await pool.one<{ model_slug: string; input: unknown }>(`SELECT model_slug, input FROM jobs WHERE id = $1`, [asset.job_id]);
  if (!job) return null;
  const input = (job.input && typeof job.input === "object" ? job.input : {}) as Record<string, unknown>;
  return (input.prompt ?? input.text ?? null) as string | null;
}

async function derivedFrom(pool: Pool, asset: AssetRow): Promise<string[]> {
  const rows = await pool.many<{ from_asset: string }>(
    `SELECT from_asset FROM lineage_edges WHERE to_asset = $1 ORDER BY from_asset`,
    [asset.id],
  );
  return rows.map((r) => r.from_asset);
}

/** Delete: remove the object first, then mark gone, in one request. */
export async function deleteAsset(pool: Pool, deps: AssetDeps, id: string, caller: MemberRow): Promise<void> {
  const row = await pool.one<Record<string, unknown>>(`SELECT * FROM assets WHERE id = $1`, [id]);
  if (!row) throw new ApiError(404, "not_found", "That asset does not exist.");
  const asset = assetRow(row);
  const readable = await canReadAsset(pool, asset, caller);
  if (!readable) throw new ApiError(404, "not_found", "That asset does not exist.");
  if (asset.state !== "live") {
    throw new ApiError(410, "asset_gone", "That asset is already gone.", undefined, {
      removed_at: asset.removed_at,
      reason: asset.removed_reason,
    });
  }
  if (!(await deps.storageUp())) {
    throw new ApiError(503, "storage_unavailable", "Storage is unreachable, so nothing was deleted. Try again when it returns.");
  }
  try {
    await deps.storage.delete(asset.object_key);
  } catch {
    throw new ApiError(503, "storage_unavailable", "Storage is unreachable, so nothing was deleted. Try again when it returns.");
  }
  await pool.exec(
    `UPDATE assets SET state = 'gone', removed_at = now(), removed_reason = 'deleted' WHERE id = $1`,
    [id],
  );
}

/** The expiry sweeper: expired assets behave as gone and lose their object within 15 seconds. */
export async function sweepExpiry(pool: Pool, deps: AssetDeps): Promise<void> {
  const expired = await pool.many<Record<string, unknown>>(
    `SELECT id, object_key FROM assets WHERE state = 'live' AND expires_at <= now()`,
  );
  for (const row of expired) {
    const id = row.id as string;
    const key = row.object_key as string;
    await pool.exec(
      `UPDATE assets SET state = 'gone', removed_at = expires_at, removed_reason = 'expired' WHERE id = $1 AND state = 'live'`,
      [id],
    );
    try {
      await deps.storage.delete(key);
    } catch {
      // The next sweep retries the object removal.
    }
  }
}

export interface LineageNode {
  id: string;
  state: "live" | "tombstone";
  removed_at?: string;
  reason?: string;
  media_type?: string;
  model?: string;
  job_id?: string;
  created_at?: string;
  thumbnail_url?: string;
  prompt?: string;
}

/** Lineage: the asset plus every asset reachable in either direction, edges the caller may see. */
export async function lineage(
  pool: Pool,
  deps: AssetDeps,
  id: string,
  caller: MemberRow,
): Promise<{ nodes: Record<string, unknown>[]; edges: { from: string; to: string }[] }> {
  const root = await pool.one<Record<string, unknown>>(`SELECT * FROM assets WHERE id = $1`, [id]);
  if (!root) throw new ApiError(404, "not_found", "That asset does not exist.");
  const rootAsset = assetRow(root);
  const readable = await canReadAsset(pool, rootAsset, caller);
  if (!readable) throw new ApiError(404, "not_found", "That asset does not exist.");
  if (rootAsset.state !== "live") {
    throw new ApiError(410, "asset_gone", "That asset is already gone.", undefined, {
      removed_at: rootAsset.removed_at,
      reason: rootAsset.removed_reason,
    });
  }

  // Walk the graph of all edges, then filter to the edges the caller may see.
  const allEdges = await pool.many<{ from_asset: string; to_asset: string; job_id: string }>(
    `SELECT from_asset, to_asset, job_id FROM lineage_edges`,
  );
  const adjacent = new Map<string, Set<string>>();
  for (const e of allEdges) {
    if (!adjacent.has(e.from_asset)) adjacent.set(e.from_asset, new Set());
    if (!adjacent.has(e.to_asset)) adjacent.set(e.to_asset, new Set());
    adjacent.get(e.from_asset)!.add(e.to_asset);
    adjacent.get(e.to_asset)!.add(e.from_asset);
  }
  const reachable = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const next of adjacent.get(cur) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const rows = await pool.many<Record<string, unknown>>(
    `SELECT * FROM assets WHERE id = ANY($1::text[])`,
    [[...reachable]],
  );
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) byId.set(r.id as string, r);

  // Visible edges: the producing job's payload must be visible to the caller.
  const visibleEdges: { from: string; to: string }[] = [];
  for (const e of allEdges) {
    if (!reachable.has(e.from_asset) || !reachable.has(e.to_asset)) continue;
    const job = await pool.one<{ team_id: string; submitted_by: string }>(
      `SELECT team_id, submitted_by FROM jobs WHERE id = $1`,
      [e.job_id],
    );
    if (job && !(await payloadVisibleTo(pool, job, caller))) continue;
    visibleEdges.push({ from: e.from_asset, to: e.to_asset });
  }

  // Nodes ordered by creation time, ties by asset id number.
  const ordered = [...reachable].sort((a, b) => {
    const ra = byId.get(a);
    const rb = byId.get(b);
    const ca = ra ? (ra.created_at as Date).getTime() : 0;
    const cb = rb ? (rb.created_at as Date).getTime() : 0;
    if (ca !== cb) return ca - cb;
    return num(a) - num(b);
  });

  const nodes: Record<string, unknown>[] = [];
  for (const nodeId of ordered) {
    const r = byId.get(nodeId);
    if (!r) continue;
    const asset = assetRow(r);
    if (asset.state === "live") {
      const visible = await promptVisibleForAsset(pool, asset, caller);
      const node: Record<string, unknown> = {
        id: asset.id,
        state: "live",
        media_type: asset.media_type,
        model: asset.model_slug,
        job_id: asset.job_id,
        created_at: iso(asset.created_at),
      };
      if (asset.media_type.startsWith("image/")) {
        node.thumbnail_url = deps.storage.presignGet(asset.object_key, SIGNED_LINK_SECONDS);
      }
      if (visible) node.prompt = await promptOfAsset(pool, asset);
      nodes.push(node);
    } else {
      nodes.push({
        id: asset.id,
        state: "tombstone",
        removed_at: iso(asset.removed_at as Date),
        reason: asset.removed_reason,
      });
    }
  }

  // Edges ordered by the position of from, then to.
  const pos = new Map(ordered.map((n, i) => [n, i]));
  visibleEdges.sort((a, b) => (pos.get(a.from) ?? 0) - (pos.get(b.from) ?? 0) || (pos.get(a.to) ?? 0) - (pos.get(b.to) ?? 0));
  return { nodes, edges: visibleEdges };
}

function num(id: string): number {
  const m = /a_(\d+)/.exec(id);
  return m ? Number(m[1]) : 0;
}

export interface SearchQuery {
  q?: string;
  kind?: string;
  model?: string;
  team?: string;
}

/** Search live assets the caller may see, matching all words. */
export async function searchAssets(
  pool: Pool,
  caller: MemberRow,
  query: SearchQuery,
): Promise<AssetRow[]> {
  const words = (query.q ?? "").split(/\s+/).filter((w) => w.length > 0).map((w) => w.toLowerCase());
  const rows = await pool.many<Record<string, unknown>>(
    `SELECT a.* FROM assets a
     LEFT JOIN models m ON m.slug = a.model_slug
     WHERE a.state = 'live'
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 1000`,
  );
  const out: AssetRow[] = [];
  for (const r of rows) {
    const asset = assetRow(r);
    if (!(await canReadAsset(pool, asset, caller))) continue;
    if (asset.kind === "output") {
      const visible = await promptVisibleForAsset(pool, asset, caller);
      if (!visible) {
        // Hidden prompts never match prompt words.
        const haystack = `${asset.model_slug ?? ""} ${asset.id}`.toLowerCase();
        if (!words.every((w) => haystack.includes(w))) continue;
      }
    }
    if (query.kind && asset.kind !== query.kind) continue;
    if (query.model && asset.model_slug !== query.model) continue;
    if (query.team && asset.team_id !== query.team) continue;
    const modelRow = await pool.one<{ name: string; slug: string }>(`SELECT name, slug FROM models WHERE slug = $1`, [asset.model_slug]);
    const prompt = asset.kind === "output" ? await promptOfAsset(pool, asset) : null;
    const haystack = [modelRow?.name ?? "", modelRow?.slug ?? "", asset.id, prompt ?? ""].join(" ").toLowerCase();
    if (!words.every((w) => haystack.includes(w))) continue;
    out.push(asset);
    if (out.length >= 100) break;
  }
  return out;
}

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export type { Tx };
