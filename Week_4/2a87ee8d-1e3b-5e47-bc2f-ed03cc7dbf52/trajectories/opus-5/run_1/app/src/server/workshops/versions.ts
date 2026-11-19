import type { PoolClient } from 'pg';
import { withTransaction, type Queryable } from '../db/pool.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import { isoTimestamp } from '../domain/schedule.js';
import { recordActivity } from '../activity.js';
import { bumpVersion, lockWorkshop, writeSnapshot, type BoardSnapshot } from '../board/repository.js';
import type { FacilitatorActor } from '../auth/sessions.js';
import { queueUnreferencedImage } from './trash.js';
import type { StoredCluster, StoredConnector, StoredFrame, StoredNote } from '../domain/views.js';

export type VersionReason = 'auto' | 'close' | 'before_restore';

export interface VersionEntry {
  readonly id: string;
  readonly version: number;
  readonly reason: VersionReason;
  readonly createdAt: string;
  readonly noteCount: number;
}

export async function listVersions(executor: Queryable, workshopId: string): Promise<VersionEntry[]> {
  const result = await executor.query<{
    id: string;
    version: number;
    reason: VersionReason;
    created_at: Date;
    note_count: number;
  }>(
    `SELECT id, version, reason, created_at, note_count FROM board_versions
      WHERE workshop_id = $1 ORDER BY version DESC, created_at DESC`,
    [workshopId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    version: Number(row.version),
    reason: row.reason,
    createdAt: isoTimestamp(row.created_at.getTime()),
    noteCount: row.note_count,
  }));
}

export interface RestoreVersionResult {
  readonly restoredFrom: number;
  readonly saved: { readonly id: string; readonly version: number };
}

/**
 * Restoring a version is one operation that raises `version` once and fans out like any other
 * change. The dot ledger is untouched, because it is always empty in the states where restore
 * is allowed.
 */
export async function restoreVersion(
  facilitator: FacilitatorActor,
  workshopId: string,
  versionId: string,
  nowMs: number,
): Promise<RestoreVersionResult> {
  return withTransaction(async (client) => {
    const workshop = await lockWorkshop(client, workshopId);
    const found = await client.query<{ version: number; snapshot: BoardSnapshot }>(
      'SELECT version, snapshot FROM board_versions WHERE id = $1 AND workshop_id = $2',
      [versionId, workshopId],
    );
    const target = found.rows[0];
    if (!target) throw new AppError('not_found');

    // The current board is saved first, so restoring that version undoes this restore.
    const savedVersion = workshop.version;
    const savedId = await writeSnapshot(client, workshopId, savedVersion, 'before_restore');

    await applySnapshot(client, workshopId, target.snapshot, workshop.status === 'revealed', nowMs);

    const version = await bumpVersion(client, workshopId);
    await recordActivity(client, {
      facilitatorId: facilitator.facilitatorId,
      actor: 'facilitator',
      action: 'version.restored',
      workshopId,
    });
    return { restoredFrom: Number(target.version), saved: { id: savedId, version: savedVersion } };
  });
}

async function applySnapshot(
  client: PoolClient,
  workshopId: string,
  snapshot: BoardSnapshot,
  revealAll: boolean,
  nowMs: number,
): Promise<void> {
  const frames = snapshot.frames as unknown as StoredFrame[];
  const clusters = snapshot.clusters as unknown as StoredCluster[];
  const notes = snapshot.notes as unknown as StoredNote[];
  const connectors = snapshot.connectors as unknown as StoredConnector[];

  // A frame at or past its purge time stays out, with its notes, clusters and connectors.
  const purged = await client.query<{ id: string }>(
    `SELECT id FROM frames
      WHERE workshop_id = $1 AND (purged_at IS NOT NULL OR (purge_at IS NOT NULL AND purge_at <= now()))`,
    [workshopId],
  );
  const excluded = new Set(purged.rows.map((row) => row.id));
  const keptFrames = frames.filter((frame) => !excluded.has(frame.id));
  const keptFrameIds = new Set(keptFrames.map((frame) => frame.id));
  const keptNotes = notes.filter((note) => keptFrameIds.has(note.frameId));
  const keptNoteIds = new Set(keptNotes.map((note) => note.id));

  // Frames on the board but absent from the snapshot move to trash.
  await client.query(
    `UPDATE frames
        SET trashed_at = now(), purge_at = now() + ($3 || ' seconds')::interval
      WHERE workshop_id = $1 AND trashed_at IS NULL AND purged_at IS NULL
        AND NOT (id = ANY($2::text[]))`,
    [workshopId, [...keptFrameIds], String(config.trashPurgeSeconds)],
  );

  // Trashed frames present in the snapshot leave trash.
  await client.query(
    `UPDATE frames SET trashed_at = NULL, purge_at = NULL
      WHERE workshop_id = $1 AND id = ANY($2::text[]) AND purged_at IS NULL
        AND (purge_at IS NULL OR purge_at > now())`,
    [workshopId, [...keptFrameIds]],
  );

  for (const frame of keptFrames) {
    await client.query(
      `INSERT INTO frames (id, workshop_id, title, x, y, width, height, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, x = EXCLUDED.x, y = EXCLUDED.y,
         width = EXCLUDED.width, height = EXCLUDED.height, position = EXCLUDED.position`,
      [frame.id, workshopId, frame.title, frame.x, frame.y, frame.width, frame.height, frame.position],
    );
  }

  const keptClusters = clusters.filter((cluster) => keptFrameIds.has(cluster.frameId));
  await client.query(
    `DELETE FROM clusters WHERE workshop_id = $1 AND NOT (id = ANY($2::text[]))
       AND frame_id IN (SELECT id FROM frames WHERE workshop_id = $1 AND trashed_at IS NULL)`,
    [workshopId, keptClusters.map((cluster) => cluster.id)],
  );
  for (const cluster of keptClusters) {
    await client.query(
      `INSERT INTO clusters (id, workshop_id, frame_id, title, x, y)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET frame_id = EXCLUDED.frame_id, title = EXCLUDED.title,
         x = EXCLUDED.x, y = EXCLUDED.y`,
      [cluster.id, workshopId, cluster.frameId, cluster.title, cluster.x, cluster.y],
    );
  }

  // Notes created after the snapshot are removed.
  const removed = await client.query<{ image_id: string }>(
    `DELETE FROM notes
      WHERE workshop_id = $1 AND NOT (id = ANY($2::text[]))
        AND frame_id IN (SELECT id FROM frames WHERE workshop_id = $1 AND trashed_at IS NULL)
      RETURNING image_id`,
    [workshopId, [...keptNoteIds]],
  );

  for (const note of keptNotes) {
    await client.query(
      `INSERT INTO notes (id, workshop_id, frame_id, cluster_id, cluster_index, kind, text, image_id,
         x, y, revealed, facilitator_only, author_kind, author_participant_id, author_name, round_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET frame_id = EXCLUDED.frame_id, cluster_id = EXCLUDED.cluster_id,
         cluster_index = EXCLUDED.cluster_index, text = EXCLUDED.text, x = EXCLUDED.x, y = EXCLUDED.y,
         revealed = EXCLUDED.revealed, facilitator_only = EXCLUDED.facilitator_only`,
      [
        note.id,
        workshopId,
        note.frameId,
        note.clusterId,
        note.clusterIndex,
        note.kind,
        note.text,
        note.imageId,
        note.x,
        note.y,
        // When the workshop is revealed, every restored note is revealed.
        revealAll ? true : note.revealed,
        note.facilitatorOnly,
        note.authorKind,
        note.authorParticipantId,
        note.authorName,
        note.roundNumber,
      ],
    );
  }

  const keptConnectors = connectors.filter(
    (connector) => keptNoteIds.has(connector.fromNoteId) && keptNoteIds.has(connector.toNoteId),
  );
  await client.query(
    `DELETE FROM connectors WHERE workshop_id = $1 AND NOT (id = ANY($2::text[]))`,
    [workshopId, keptConnectors.map((connector) => connector.id)],
  );
  for (const connector of keptConnectors) {
    await client.query(
      `INSERT INTO connectors (id, workshop_id, from_note_id, to_note_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO NOTHING`,
      [connector.id, workshopId, connector.fromNoteId, connector.toNoteId],
    );
  }

  for (const row of removed.rows) {
    if (row.image_id !== null) await queueUnreferencedImage(client, row.image_id);
  }
}
