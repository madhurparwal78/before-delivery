// Loading references and clusters, and their member-facing shapes R and C (brief: API > Shapes).
import { iso, isoOrNull, many, one, returning, type Db } from "./db.js";
import { refuse } from "./errors.js";
import type { Status } from "../shared/lifecycle.js";
import type { FrameRate } from "../shared/timecode.js";
import { isUuid } from "./validate.js";

export interface ReferenceRow {
  id: string;
  workspace_id: string;
  kind: "image" | "clip" | "still";
  title: string;
  content_type: string;
  ext: string;
  created_at: Date;
  created_by_name: string;
  created_by_handle: string;
  frame_rate: FrameRate | null;
  duration_ms: number | null;
  total_frames: number | null;
  source_clip_id: string | null;
  source_clip_title: string | null;
  frame_index: number | null;
  timecode: string | null;
}

export const REFERENCE_SELECT = `SELECT r.id, r.workspace_id, r.kind, r.title, r.content_type, r.ext, r.created_at,
  a.display_name AS created_by_name, a.handle AS created_by_handle, r.frame_rate, r.duration_ms, r.total_frames,
  r.source_clip_id, r.source_clip_title, r.frame_index, r.timecode
  FROM "references" r JOIN accounts a ON a.id = r.created_by`;

export const mediaUrl = (referenceId: string): string => `/media/${referenceId}`;

export function referenceView(r: ReferenceRow) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    mediaUrl: mediaUrl(r.id),
    createdAt: iso(r.created_at),
    createdBy: { displayName: r.created_by_name, handle: r.created_by_handle },
    frameRate: r.frame_rate,
    durationMs: r.duration_ms,
    totalFrames: r.total_frames,
    sourceClipId: r.source_clip_id,
    sourceClipTitle: r.source_clip_title,
    frameIndex: r.frame_index,
    timecode: r.timecode,
  };
}

export interface ClusterRow {
  id: string;
  workspace_id: string;
  workspace_slug: string;
  workspace_group_id: string;
  time_zone: string;
  title: string;
  public_description: string;
  internal_note: string;
  status: Status;
  owner_id: string;
  owner_name: string;
  owner_handle: string;
  version: number;
  lift_local: string | null;
  lifts_at: Date | null;
  published_at: Date | null;
  item_count: number;
  public_item_count: number;
}

export interface EntryRow extends ReferenceRow {
  entry_id: string;
  position: number;
  is_private: boolean;
  added_by: string;
  added_by_role: string;
  added_by_name: string;
  added_by_handle: string;
  added_at: Date;
}

const CLUSTER_SELECT = `SELECT c.id, c.workspace_id, w.slug AS workspace_slug, w.group_id AS workspace_group_id, w.time_zone,
  c.title, c.public_description, c.internal_note, c.status, c.owner_id, o.display_name AS owner_name, o.handle AS owner_handle,
  c.version, c.lift_local, c.lifts_at, c.published_at,
  (SELECT count(*)::int FROM entries e WHERE e.cluster_id = c.id) AS item_count,
  (SELECT count(*)::int FROM entries e WHERE e.cluster_id = c.id AND NOT e.is_private) AS public_item_count
  FROM clusters c JOIN workspaces w ON w.id = c.workspace_id JOIN accounts o ON o.id = c.owner_id`;

export async function findCluster(db: Db, id: string, lock = false): Promise<ClusterRow | null> {
  if (lock) await db.query("SELECT 1 FROM clusters WHERE id = $1 FOR UPDATE", [id]);
  return one<ClusterRow>(db, `${CLUSTER_SELECT} WHERE c.id = $1`, [id]);
}

export async function clusterOrUnknown(db: Db, id: string, lock = false): Promise<ClusterRow> {
  const cluster = isUuid(id) ? await findCluster(db, id, lock) : null;
  if (!cluster) throw refuse("not_found");
  return cluster;
}

export async function entriesOf(db: Db, clusterId: string): Promise<EntryRow[]> {
  return many<EntryRow>(
    db,
    `SELECT r.id, r.workspace_id, r.kind, r.title, r.content_type, r.ext, r.created_at,
       ca.display_name AS created_by_name, ca.handle AS created_by_handle, r.frame_rate, r.duration_ms, r.total_frames,
       r.source_clip_id, r.source_clip_title, r.frame_index, r.timecode,
       e.id AS entry_id, e.position, e.is_private, e.added_by, ad.role AS added_by_role,
       ad.display_name AS added_by_name, ad.handle AS added_by_handle, e.added_at
     FROM entries e JOIN "references" r ON r.id = e.reference_id
       JOIN accounts ca ON ca.id = r.created_by JOIN accounts ad ON ad.id = e.added_by
     WHERE e.cluster_id = $1 ORDER BY e.position`,
    [clusterId],
  );
}

/** Every change to a cluster's entries raises its version by one (brief: Business rules > Order). */
export async function bumpVersion(db: Db, clusterId: string, now: Date): Promise<{ version: number; item_count: number }> {
  return returning(
    db,
    `UPDATE clusters SET version = version + 1, changed_at = $2 WHERE id = $1
     RETURNING version, (SELECT count(*)::int FROM entries WHERE cluster_id = $1) AS item_count`,
    [clusterId, now],
  );
}

export const entryView = (e: Pick<EntryRow, "entry_id" | "position" | "is_private">) => ({
  id: e.entry_id,
  position: e.position,
  isPrivate: e.is_private,
});

export async function clusterView(db: Db, cluster: ClusterRow) {
  const entries = await entriesOf(db, cluster.id);
  return {
    id: cluster.id,
    workspace: cluster.workspace_slug,
    title: cluster.title,
    publicDescription: cluster.public_description,
    internalNote: cluster.internal_note,
    status: cluster.status,
    owner: { displayName: cluster.owner_name, handle: cluster.owner_handle },
    itemCount: cluster.item_count,
    version: cluster.version,
    timeZone: cluster.time_zone,
    liftLocal: cluster.lift_local,
    liftsAt: isoOrNull(cluster.lifts_at),
    publishedAt: isoOrNull(cluster.published_at),
    entries: entries.map((e) => ({ ...entryView(e), reference: referenceView(e) })),
  };
}

export const clusterSummary = (c: Pick<ClusterRow, "id" | "title" | "status" | "item_count">) => ({
  id: c.id,
  title: c.title,
  status: c.status,
  itemCount: c.item_count,
});

/** Cluster rows for listings: same columns as CLUSTER_SELECT, filtered by the caller's WHERE. */
export async function clusterRows(db: Db, where: string, params: unknown[], tail = ""): Promise<ClusterRow[]> {
  return many<ClusterRow>(db, `${CLUSTER_SELECT} WHERE ${where} ${tail}`, params);
}
