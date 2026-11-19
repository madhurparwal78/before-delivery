import { one, query } from './db.js';
import { effectivePublishedAt, effectiveStatus } from './domain/lift.js';
import { liftLocalOf } from './domain/embargo.js';
import type { Cluster, ClusterEntry, ClusterStatus, PlanId, Reference, ReferenceKind } from '../shared/types.js';

export interface RefRow {
  id: string;
  workspace_id: string;
  kind: ReferenceKind;
  title: string;
  object_key: string;
  content_type: string;
  created_by: string;
  created_at: Date;
  frame_rate: number | null;
  duration_ms: number | null;
  total_frames: number | null;
  source_clip_id: string | null;
  source_clip_title: string | null;
  frame_index: number | null;
  timecode: string | null;
  creator_display_name: string;
  creator_handle: string;
}

export const refSelect = `select r.*, a.display_name as creator_display_name, a.handle as creator_handle
                            from refs r join accounts a on a.id = r.created_by`;

export function toReference(row: RefRow): Reference {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    mediaUrl: `/media/${row.id}`,
    createdAt: row.created_at.toISOString(),
    createdBy: { displayName: row.creator_display_name, handle: row.creator_handle },
    frameRate: row.frame_rate,
    durationMs: row.duration_ms,
    totalFrames: row.total_frames,
    sourceClipId: row.source_clip_id,
    sourceClipTitle: row.source_clip_title,
    frameIndex: row.frame_index,
    timecode: row.timecode,
  };
}

export interface ClusterRow {
  id: string;
  workspace_id: string;
  title: string;
  public_description: string;
  internal_note: string;
  status: ClusterStatus;
  owner_id: string;
  version: number;
  lift_local: string | null;
  lifts_at: Date | null;
  published_at: Date | null;
  digests_created_at: Date | null;
  created_at: Date;
  updated_at: Date;
  owner_display_name: string;
  owner_handle: string;
  slug: string;
  name: string;
  time_zone: string;
  group_id: string;
  plan: PlanId;
  seat_cap: number;
}

export const clusterSelect = `select c.*, o.display_name as owner_display_name, o.handle as owner_handle,
                                     w.slug, w.name, w.time_zone, w.group_id, w.plan, w.seat_cap
                                from clusters c
                                join accounts o on o.id = c.owner_id
                                join workspaces w on w.id = c.workspace_id`;

export async function loadCluster(id: string): Promise<ClusterRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return null;
  }
  return one<ClusterRow>(`${clusterSelect} where c.id = $1`, [id]);
}

export interface EntryRow extends RefRow {
  entry_id: string;
  position: number;
  is_private: boolean;
  added_by: string;
  added_at: Date;
  adder_display_name: string;
  adder_handle: string;
}

const entrySelect = `select e.id as entry_id, e.position, e.is_private, e.added_by, e.added_at,
                                   ad.display_name as adder_display_name, ad.handle as adder_handle,
                                   r.*, a.display_name as creator_display_name, a.handle as creator_handle
                              from cluster_entries e
                              join refs r on r.id = e.reference_id
                              join accounts a on a.id = r.created_by
                              join accounts ad on ad.id = e.added_by`;

export async function loadEntries(clusterId: string): Promise<EntryRow[]> {
  return query<EntryRow>(`${entrySelect} where e.cluster_id = $1 order by e.position`, [clusterId]);
}

export function toEntry(row: EntryRow): ClusterEntry {
  return {
    id: row.entry_id,
    position: row.position,
    isPrivate: row.is_private,
    reference: toReference(row),
  };
}

function toCluster(row: ClusterRow, entries: readonly EntryRow[], now: Date): Cluster {
  const status = effectiveStatus(row, now);
  const publishedAt = effectivePublishedAt(row, now);
  return {
    id: row.id,
    workspace: row.slug,
    title: row.title,
    publicDescription: row.public_description,
    internalNote: row.internal_note,
    status,
    owner: { displayName: row.owner_display_name, handle: row.owner_handle },
    itemCount: entries.length,
    version: row.version,
    timeZone: row.time_zone,
    liftLocal: row.lifts_at === null ? null : (row.lift_local ?? liftLocalOf(row.time_zone, row.lifts_at)),
    liftsAt: row.lifts_at === null ? null : row.lifts_at.toISOString(),
    publishedAt: publishedAt === null ? null : publishedAt.toISOString(),
    entries: entries.map(toEntry),
  };
}

export async function clusterView(id: string, now: Date): Promise<Cluster> {
  const row = await loadCluster(id);
  if (row === null) {
    throw new Error(`Cluster ${id} disappeared`);
  }
  return toCluster(row, await loadEntries(id), now);
}
