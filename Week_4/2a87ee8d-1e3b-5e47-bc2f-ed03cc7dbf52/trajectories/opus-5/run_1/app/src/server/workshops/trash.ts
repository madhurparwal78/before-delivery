import type { PoolClient } from 'pg';
import { pool, withTransaction, type Queryable } from '../db/pool.js';
import { config } from '../config.js';
import { AppError } from '../errors.js';
import { isoTimestamp } from '../domain/schedule.js';
import { recordActivity } from '../activity.js';
import { bumpVersion } from '../board/repository.js';
import type { FacilitatorActor } from '../auth/sessions.js';

export interface TrashItem {
  readonly id: string;
  readonly kind: 'frame';
  readonly title: string;
  readonly deletedAt: string;
  readonly purgeAt: string;
  readonly noteCount: number;
}

/**
 * From its purge time, inclusive, a trashed frame counts as purged on every read and restore
 * path, whether or not a worker has deleted it yet.
 */
const LIVE_TRASH_CONDITION = 'trashed_at IS NOT NULL AND purged_at IS NULL AND purge_at > now()';

export async function listTrash(executor: Queryable, workshopId: string): Promise<TrashItem[]> {
  const result = await executor.query<{
    id: string;
    title: string;
    trashed_at: Date;
    purge_at: Date;
    note_count: number;
  }>(
    `SELECT f.id, f.title, f.trashed_at, f.purge_at,
            (SELECT count(*)::bigint FROM notes n
              WHERE n.frame_id = f.id AND n.facilitator_only = false) AS note_count
       FROM frames f
      WHERE f.workshop_id = $1 AND ${LIVE_TRASH_CONDITION}
      ORDER BY f.trashed_at DESC`,
    [workshopId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: 'frame',
    title: row.title,
    deletedAt: isoTimestamp(row.trashed_at.getTime()),
    purgeAt: isoTimestamp(row.purge_at.getTime()),
    noteCount: Number(row.note_count),
  }));
}

/**
 * Trashing a frame hides the frame, its notes, its clusters, every connector touching one of
 * its notes, and the dots on its clusters. Nothing is removed, so a restore is exact.
 */
export async function trashFrame(
  facilitator: FacilitatorActor,
  workshopId: string,
  frameId: string,
): Promise<TrashItem> {
  return withTransaction(async (client) => {
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM frames WHERE id = $1 AND workshop_id = $2 AND trashed_at IS NULL AND purged_at IS NULL FOR UPDATE`,
      [frameId, workshopId],
    );
    if (owned.rowCount === 0) throw new AppError('not_found');

    // `purgeAt` is fixed when the item is trashed, by the instance that took it.
    const updated = await client.query<{ title: string; trashed_at: Date; purge_at: Date }>(
      `UPDATE frames
          SET trashed_at = now(), purge_at = now() + ($3 || ' seconds')::interval
        WHERE id = $1 AND workshop_id = $2
        RETURNING title, trashed_at, purge_at`,
      [frameId, workshopId, String(config.trashPurgeSeconds)],
    );
    const row = updated.rows[0];
    if (!row) throw new AppError('not_found');

    const counted = await client.query<{ note_count: number }>(
      `SELECT count(*)::bigint AS note_count FROM notes WHERE frame_id = $1 AND facilitator_only = false`,
      [frameId],
    );
    await bumpVersion(client, workshopId);
    await recordActivity(client, {
      facilitatorId: facilitator.facilitatorId,
      actor: 'facilitator',
      action: 'frame.trashed',
      workshopId,
    });
    return {
      id: frameId,
      kind: 'frame' as const,
      title: row.title,
      deletedAt: isoTimestamp(row.trashed_at.getTime()),
      purgeAt: isoTimestamp(row.purge_at.getTime()),
      noteCount: Number(counted.rows[0]?.note_count ?? 0),
    };
  });
}

export interface RestoreCounts {
  readonly notes: number;
  readonly clusters: number;
  readonly connectors: number;
  readonly dots: number;
}

export interface RestoreResult {
  readonly frameId: string;
  readonly restored: RestoreCounts;
}

/**
 * Restoring before `purgeAt` brings the frame back with every note, cluster membership and
 * order, connector and dot exactly as they were.
 */
export async function restoreTrashItem(
  facilitator: FacilitatorActor,
  workshopId: string,
  trashId: string,
): Promise<RestoreResult> {
  return withTransaction(async (client) => {
    const found = await client.query<{ id: string }>(
      `SELECT id FROM frames WHERE id = $1 AND workshop_id = $2 AND ${LIVE_TRASH_CONDITION} FOR UPDATE`,
      [trashId, workshopId],
    );
    if (found.rowCount === 0) throw new AppError('not_found');

    const counts = await countFrameContents(client, trashId);
    await client.query('UPDATE frames SET trashed_at = NULL, purge_at = NULL WHERE id = $1', [trashId]);
    await bumpVersion(client, workshopId);
    await recordActivity(client, {
      facilitatorId: facilitator.facilitatorId,
      actor: 'facilitator',
      action: 'frame.restored',
      workshopId,
    });
    return { frameId: trashId, restored: counts };
  });
}

async function countFrameContents(client: PoolClient, frameId: string): Promise<RestoreCounts> {
  const result = await client.query<{
    notes: number;
    clusters: number;
    connectors: number;
    dots: number;
  }>(
    `SELECT
       (SELECT count(*)::bigint FROM notes WHERE frame_id = $1) AS notes,
       (SELECT count(*)::bigint FROM clusters WHERE frame_id = $1) AS clusters,
       (SELECT count(*)::bigint FROM connectors c
          WHERE EXISTS (SELECT 1 FROM notes n WHERE n.id = c.from_note_id AND n.frame_id = $1)
             OR EXISTS (SELECT 1 FROM notes n WHERE n.id = c.to_note_id AND n.frame_id = $1)) AS connectors,
       (SELECT count(*)::bigint FROM dot_entries d
          WHERE d.cluster_id IN (SELECT id FROM clusters WHERE frame_id = $1)) AS dots`,
    [frameId],
  );
  const row = result.rows[0];
  return {
    notes: Number(row?.notes ?? 0),
    clusters: Number(row?.clusters ?? 0),
    connectors: Number(row?.connectors ?? 0),
    dots: Number(row?.dots ?? 0),
  };
}

/**
 * At its first worker tick at or after `purgeAt`, the worker deletes the frame and its
 * contents for good, removes them from every stored version and queues any image whose last
 * reference has gone.
 */
export async function purgeDueFrames(): Promise<void> {
  const due = await pool.query<{ id: string; workshop_id: string; facilitator_id: string }>(
    `SELECT f.id, f.workshop_id, w.facilitator_id
       FROM frames f JOIN workshops w ON w.id = f.workshop_id
      WHERE f.trashed_at IS NOT NULL AND f.purged_at IS NULL AND f.purge_at <= now()`,
  );
  for (const frame of due.rows) {
    await withTransaction(async (client) => {
      const images = await client.query<{ image_id: string }>(
        'SELECT image_id FROM notes WHERE frame_id = $1 AND image_id IS NOT NULL',
        [frame.id],
      );
      await client.query('UPDATE frames SET purged_at = now() WHERE id = $1', [frame.id]);
      await client.query('DELETE FROM notes WHERE frame_id = $1', [frame.id]);
      await client.query('DELETE FROM clusters WHERE frame_id = $1', [frame.id]);
      await client.query('DELETE FROM frames WHERE id = $1', [frame.id]);
      await removeFrameFromVersions(client, frame.workshop_id, frame.id);
      await recordActivity(client, {
        facilitatorId: frame.facilitator_id,
        actor: 'system',
        action: 'frame.purged',
        workshopId: frame.workshop_id,
      });
      for (const row of images.rows) await queueUnreferencedImage(client, row.image_id);
    });
  }
}

/** Removes a purged frame and its contents from every stored version. */
async function removeFrameFromVersions(
  client: PoolClient,
  workshopId: string,
  frameId: string,
): Promise<void> {
  const versions = await client.query<{ id: string; snapshot: Record<string, unknown> }>(
    'SELECT id, snapshot FROM board_versions WHERE workshop_id = $1',
    [workshopId],
  );
  for (const version of versions.rows) {
    const snapshot = version.snapshot as {
      frames: Array<{ id: string }>;
      clusters: Array<{ frameId: string }>;
      notes: Array<{ id: string; frameId: string }>;
      connectors: Array<{ fromNoteId: string; toNoteId: string }>;
    };
    const removedNoteIds = new Set(
      snapshot.notes.filter((note) => note.frameId === frameId).map((note) => note.id),
    );
    const next = {
      frames: snapshot.frames.filter((frame) => frame.id !== frameId),
      clusters: snapshot.clusters.filter((cluster) => cluster.frameId !== frameId),
      notes: snapshot.notes.filter((note) => note.frameId !== frameId),
      connectors: snapshot.connectors.filter(
        (connector) => !removedNoteIds.has(connector.fromNoteId) && !removedNoteIds.has(connector.toNoteId),
      ),
    };
    await client.query('UPDATE board_versions SET snapshot = $2::jsonb WHERE id = $1', [
      version.id,
      JSON.stringify(next),
    ]);
  }
}

/**
 * Queues an image for deletion once no note, trashed frame or stored version uses it.
 * The object is removed before the response when storage is reachable, and by a worker
 * otherwise.
 */
export async function queueUnreferencedImage(client: PoolClient, imageId: string): Promise<void> {
  const referenced = await client.query(
    `SELECT 1 FROM notes WHERE image_id = $1
      UNION ALL
     SELECT 1 FROM board_versions WHERE snapshot::text LIKE '%' || $1 || '%'
      LIMIT 1`,
    [imageId],
  );
  if ((referenced.rowCount ?? 0) > 0) return;
  await client.query(
    `INSERT INTO image_deletions (image_id, object_key)
     SELECT id, object_key FROM images WHERE id = $1
     ON CONFLICT (image_id) DO NOTHING`,
    [imageId],
  );
}
