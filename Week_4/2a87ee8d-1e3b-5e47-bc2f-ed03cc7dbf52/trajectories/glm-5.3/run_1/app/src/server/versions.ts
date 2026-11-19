/**
 * Version history, trash and restore (DP-59, DP-31, DP-70): the version bump,
 * the auto/close/before_restore snapshots, the purge-at-read rule and restores.
 */
import type { PoolClient } from 'pg';
import { newId } from './ids.js';
import { loadBoard } from './board.js';
import { ApiError } from './http.js';
import { isPastPurge } from './purge.js';

/** Snapshot kinds and their reason labels (Business rules). */
export type VersionReason = 'auto' | 'close' | 'before_restore';

export const VERSION_REASON_LABELS: Record<VersionReason, string> = {
  auto: 'Autosave',
  close: 'At close',
  before_restore: 'Before restore',
};

interface Snapshot {
  frames: Array<{ id: string; title: string; x: number; y: number; width: number; height: number; position: number }>;
  notes: Array<{
    id: string; frameId: string; clusterId: string | null; kind: string; text: string | null; imageId: string | null;
    x: number; y: number; revealed: boolean; facilitatorOnly: boolean;
    authorParticipantId: string | null; authorFacilitator: boolean; authorName: string;
    roundNumber: number; placementIndex: number;
  }>;
  clusters: Array<{ id: string; frameId: string; title: string; x: number; y: number }>;
  connectors: Array<{ id: string; fromNoteId: string; toNoteId: string }>;
}

async function takeSnapshot(c: PoolClient, workshopId: string, version: number, reason: VersionReason): Promise<void> {
  const state = await loadBoard(c, workshopId);
  if (!state) return;
  const visibleFrames = state.frames.filter((f) => f.trashed_at === null);
  const visibleIds = new Set(visibleFrames.map((f) => f.id));
  const snapshot: Snapshot = {
    frames: visibleFrames.map((f) => ({ id: f.id, title: f.title, x: f.x, y: f.y, width: f.width, height: f.height, position: f.position })),
    notes: state.notes.filter((n) => visibleIds.has(n.frame_id)).map((n) => ({
      id: n.id, frameId: n.frame_id, clusterId: n.cluster_id, kind: n.kind, text: n.text, imageId: n.image_id,
      x: n.x, y: n.y, revealed: n.revealed, facilitatorOnly: n.facilitator_only,
      authorParticipantId: n.author_participant_id, authorFacilitator: n.author_facilitator, authorName: n.author_name,
      roundNumber: n.round_number, placementIndex: n.placement_index,
    })),
    clusters: state.clusters.filter((cl) => visibleIds.has(cl.frame_id)).map((cl) => ({ id: cl.id, frameId: cl.frame_id, title: cl.title, x: cl.x, y: cl.y })),
    connectors: state.connectors
      .filter((cn) => visibleIds.has(state.notes.find((n) => n.id === cn.from_note_id)?.frame_id ?? '')
        && visibleIds.has(state.notes.find((n) => n.id === cn.to_note_id)?.frame_id ?? ''))
      .map((cn) => ({ id: cn.id, fromNoteId: cn.from_note_id, toNoteId: cn.to_note_id })),
  };
  await c.query('insert into versions (id, workshop_id, version, reason, snapshot, note_count) values ($1,$2,$3,$4,$5,$6)',
    [newId('ver'), workshopId, version, reason, JSON.stringify(snapshot), snapshot.notes.length]);
}

/**
 * Raise the workshop version by one, taking an `auto` snapshot when the new
 * version is a multiple of 50. Every committed board change goes through here.
 */
export async function bumpVersion(c: PoolClient, workshopId: string): Promise<number> {
  const row = (await c.query('update workshops set version = version + 1 where id = $1 returning version', [workshopId])).rows[0] as { version: number } | undefined;
  const version = row?.version ?? 0;
  if (version % 50 === 0) {
    await takeSnapshot(c, workshopId, version, 'auto');
  }
  await c.query('insert into board_events (workshop_id, version) values ($1,$2) on conflict do nothing', [workshopId, version]);
  // notify every instance (fired at commit)
  await c.query('select pg_notify($1, $2)', ['lf_change', `${workshopId}|${version}|`]);
  return version;
}

/** Notify every instance that participant sessions ended (DP-57). */
export async function notifyEnded(c: PoolClient, workshopId: string, participantIds: string[]): Promise<void> {
  if (participantIds.length === 0) return;
  const row = (await c.query('select version from workshops where id = $1', [workshopId])).rows[0] as { version: number } | undefined;
  await c.query('select pg_notify($1, $2)', ['lf_change', `${workshopId}|${row?.version ?? 0}|${participantIds.join(',')}`]);
}

export async function snapshotForClose(c: PoolClient, workshopId: string, version: number): Promise<void> {
  await takeSnapshot(c, workshopId, version, 'close');
}

export async function snapshotBeforeRestore(c: PoolClient, workshopId: string, version: number): Promise<void> {
  await takeSnapshot(c, workshopId, version, 'before_restore');
}

export interface StoredVersion {
  id: string; workshop_id: string; version: number; reason: VersionReason;
  snapshot: Snapshot; created_at: Date; note_count: number;
}

export async function versionsOf(c: PoolClient, workshopId: string): Promise<StoredVersion[]> {
  const rows = (await c.query('select * from versions where workshop_id = $1 order by created_at desc, version desc', [workshopId])).rows;
  return rows as unknown as StoredVersion[];
}

/**
 * Restore a version (DP-59): one operation, version rises once, before_restore
 * snapshot written first. Purged frames stay out (purge-at-read, DP-70).
 */
export async function restoreVersion(c: PoolClient, workshopId: string, versionId: string, trashPurgeSeconds: number): Promise<{ restoredFrom: number; saved: { id: string; version: number } }> {
  const all = await versionsOf(c, workshopId);
  const target = all.find((v) => v.id === versionId);
  if (!target) throw new ApiError(404, 'not_found');
  const row = (await c.query('select version, status from workshops where id = $1 for update', [workshopId])).rows[0] as { version: number; status: string } | undefined;
  if (!row) throw new ApiError(404, 'not_found');
  const status = row.status;
  // restore is allowed only in draft, open and revealed
  if (status === 'silent_round' || status === 'voting') throw new ApiError(409, 'phase_locked', { message: `That isn't available while the workshop is ${status === 'voting' ? 'Voting' : 'Silent round'}` });
  if (status === 'closed' || status === 'archived') throw new ApiError(409, 'workshop_closed');

  // the previous board is saved as a version first
  const currentVersion = row.version;
  const savedVersionId = newId('ver');
  await bumpVersion(c, workshopId);
  const savedVersion = currentVersion + 1;
  // write the before_restore snapshot manually with the bumped version
  await takeSnapshotWithId(c, savedVersionId, workshopId, savedVersion, 'before_restore');

  const snap = target.snapshot;
  const now = new Date();
  const liveFrames = (await c.query('select * from frames where workshop_id = $1', [workshopId])).rows as Array<{ id: string; trashed_at: Date | null; purge_at: Date | null }>;
  const snapFrameIds = new Set(snap.frames.map((f) => f.id));

  // frames on the board but absent from the snapshot move to trash
  for (const f of liveFrames) {
    if (f.trashed_at === null && !snapFrameIds.has(f.id)) {
      await c.query('update frames set trashed_at = $2, purge_at = $3 where id = $1',
        [f.id, now, new Date(now.getTime() + trashPurgeSeconds * 1000)]);
    }
    // trashed frames present in the snapshot leave trash, unless purged
    if (f.trashed_at !== null && snapFrameIds.has(f.id) && !isPastPurge(f)) {
      await c.query('update frames set trashed_at = null, purge_at = null where id = $1', [f.id]);
    }
  }
  // delete notes created after the snapshot, and restore snapshot notes
  const snapNoteIds = new Set(snap.notes.map((n) => n.id));
  const liveNotes = (await c.query('select id, created_at from notes where workshop_id = $1 and deleted = false', [workshopId])).rows as Array<{ id: string }>;
  for (const n of liveNotes) {
    if (!snapNoteIds.has(n.id)) {
      await c.query('update notes set deleted = true where id = $1', [n.id]);
    }
  }
  for (const n of snap.notes) {
    await c.query(
      `insert into notes (id, workshop_id, frame_id, cluster_id, kind, text, image_id, x, y, revealed, facilitator_only,
         author_participant_id, author_facilitator, author_name, round_number, placement_index, deleted, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false, coalesce((select created_at from notes where id = $1), $17))
       on conflict (id) do update set frame_id=$3, cluster_id=$4, kind=$5, text=$6, image_id=$7, x=$8, y=$9,
         revealed=$10, facilitator_only=$11, placement_index=$16, deleted=false`,
      [n.id, workshopId, n.frameId, n.clusterId, n.kind, n.text, n.imageId, n.x, n.y,
        status === 'revealed' ? true : n.revealed, n.facilitatorOnly,
        n.authorParticipantId, n.authorFacilitator, n.authorName, n.roundNumber, n.placementIndex, now]);
  }
  // clusters and connectors follow the snapshot
  await c.query('delete from clusters where workshop_id = $1', [workshopId]);
  for (const cl of snap.clusters) {
    await c.query(
      `insert into clusters (id, workshop_id, frame_id, title, x, y, created_at)
       values ($1,$2,$3,$4,$5,$6, coalesce((select created_at from clusters where id = $1), $7))
       on conflict (id) do nothing`,
      [cl.id, workshopId, cl.frameId, cl.title, cl.x, cl.y, now]);
  }
  await c.query('delete from connectors where workshop_id = $1', [workshopId]);
  for (const cn of snap.connectors) {
    await c.query(
      `insert into connectors (id, workshop_id, from_note_id, to_note_id) values ($1,$2,$3,$4)
       on conflict (id) do nothing`,
      [cn.id, workshopId, cn.fromNoteId, cn.toNoteId]);
  }
  return { restoredFrom: target.version, saved: { id: savedVersionId, version: savedVersion } };
}

async function takeSnapshotWithId(c: PoolClient, id: string, workshopId: string, version: number, reason: VersionReason): Promise<void> {
  // like takeSnapshot but with a known id
  const state = await loadBoard(c, workshopId);
  if (!state) return;
  const visibleFrames = state.frames.filter((f) => f.trashed_at === null);
  const visibleIds = new Set(visibleFrames.map((f) => f.id));
  const snapshot: Snapshot = {
    frames: visibleFrames.map((f) => ({ id: f.id, title: f.title, x: f.x, y: f.y, width: f.width, height: f.height, position: f.position })),
    notes: state.notes.filter((n) => visibleIds.has(n.frame_id)).map((n) => ({
      id: n.id, frameId: n.frame_id, clusterId: n.cluster_id, kind: n.kind, text: n.text, imageId: n.image_id,
      x: n.x, y: n.y, revealed: n.revealed, facilitatorOnly: n.facilitator_only,
      authorParticipantId: n.author_participant_id, authorFacilitator: n.author_facilitator, authorName: n.author_name,
      roundNumber: n.round_number, placementIndex: n.placement_index,
    })),
    clusters: state.clusters.filter((cl) => visibleIds.has(cl.frame_id)).map((cl) => ({ id: cl.id, frameId: cl.frame_id, title: cl.title, x: cl.x, y: cl.y })),
    connectors: state.connectors.map((cn) => ({ id: cn.id, fromNoteId: cn.from_note_id, toNoteId: cn.to_note_id })),
  };
  await c.query('insert into versions (id, workshop_id, version, reason, snapshot, note_count) values ($1,$2,$3,$4,$5,$6)',
    [id, workshopId, version, reason, JSON.stringify(snapshot), snapshot.notes.length]);
}

