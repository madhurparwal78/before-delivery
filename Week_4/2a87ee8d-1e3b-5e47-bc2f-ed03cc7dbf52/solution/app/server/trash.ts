// Frame trash, exact restore and purge. The purge-at-read rule lives in `liveTrash`.
import { config } from "./config.js";
import { newId, type Db } from "./db.js";
import { fail } from "./errors.js";
import { record } from "./activity.js";
import { releaseImage } from "./images.js";

/** A trash item counts as purged on every read from its purgeAt, inclusive, whether or not a worker has run. */
export function liveTrash(alias: string): string {
  return `(${alias}.restored_at IS NULL AND ${alias}.purged_at IS NULL AND ${alias}.purge_at > now())`;
}

interface TrashRow {
  id: string;
  frame_id: string;
  title: string;
  deleted_at: Date;
  purge_at: Date;
}

async function noteCount(t: Db, frameId: string): Promise<number> {
  const row = await t.one<{ n: number }>("SELECT count(*) AS n FROM notes WHERE frame_id = $1 AND NOT facilitator_only", [frameId]);
  return row?.n ?? 0;
}

async function itemJson(t: Db, item: TrashRow) {
  return {
    id: item.id,
    kind: "frame",
    title: item.title,
    deletedAt: item.deleted_at.toISOString(),
    purgeAt: item.purge_at.toISOString(),
    noteCount: await noteCount(t, item.frame_id),
  };
}

/** Moves a frame to trash; its notes, clusters, connectors and dots go with it. */
export async function trashFrame(t: Db, workshopId: string, frame: { id: string; title: string }) {
  const item = await t.one<TrashRow>(
    `INSERT INTO trash_items (id, workshop_id, frame_id, title, deleted_at, purge_at)
     VALUES ($1, $2, $3, $4, now(), now() + make_interval(secs => $5)) RETURNING id, frame_id, title, deleted_at, purge_at`,
    [newId(), workshopId, frame.id, frame.title, config.trashPurgeSeconds],
  );
  if (!item) throw new Error("trash insert failed");
  await t.run("UPDATE frames SET trash_id = $2 WHERE id = $1", [frame.id, item.id]);
  return itemJson(t, item);
}

export async function listTrash(t: Db, workshopId: string) {
  const items = await t.rows<TrashRow>(
    `SELECT t.id, t.frame_id, t.title, t.deleted_at, t.purge_at FROM trash_items t WHERE t.workshop_id = $1 AND ${liveTrash("t")} ORDER BY t.deleted_at DESC`,
    [workshopId],
  );
  return Promise.all(items.map((item) => itemJson(t, item)));
}

/** Untrashes a frame before its purge time, with every note, cluster, connector and dot as it was. */
export async function restoreTrash(t: Db, workshopId: string, itemId: string) {
  const item = await t.one<TrashRow>(`SELECT t.* FROM trash_items t WHERE t.id = $1 AND t.workshop_id = $2 AND ${liveTrash("t")} FOR UPDATE`, [
    itemId,
    workshopId,
  ]);
  if (!item) fail("not_found");
  await t.run("UPDATE trash_items SET restored_at = now() WHERE id = $1", [item.id]);
  await t.run("UPDATE frames SET trash_id = NULL WHERE id = $1", [item.frame_id]);
  const counts = await t.one<{ notes: number; clusters: number; connectors: number; dots: number }>(
    `SELECT (SELECT count(*) FROM notes WHERE frame_id = $1) AS notes,
            (SELECT count(*) FROM clusters WHERE frame_id = $1) AS clusters,
            (SELECT count(*) FROM connectors c WHERE EXISTS (SELECT 1 FROM notes n WHERE n.frame_id = $1 AND n.id IN (c.from_note, c.to_note))) AS connectors,
            (SELECT count(*) FROM dot_ledger d WHERE d.cluster_id IN (SELECT id FROM clusters WHERE frame_id = $1)) AS dots`,
    [item.frame_id],
  );
  return { frameId: item.frame_id, restored: counts ?? { notes: 0, clusters: 0, connectors: 0, dots: 0 } };
}

function removeFrameFromSnapshot(snapshot: Snapshot, frameId: string): Snapshot {
  const gone = new Set(snapshot.notes.filter((n) => n.frame_id === frameId).map((n) => n.id));
  return {
    ...snapshot,
    frames: snapshot.frames.filter((f) => f.id !== frameId),
    notes: snapshot.notes.filter((n) => !gone.has(n.id)),
    clusters: snapshot.clusters.filter((c) => c.frame_id !== frameId),
    connectors: snapshot.connectors.filter((c) => !gone.has(c.from_note) && !gone.has(c.to_note)),
  };
}

export interface Snapshot {
  frames: { id: string; title: string; x: number; y: number; width: number; height: number; position: number }[];
  notes: (Record<string, unknown> & { id: string; frame_id: string; image_id: string | null })[];
  clusters: (Record<string, unknown> & { id: string; frame_id: string })[];
  connectors: { id: string; from_note: string; to_note: string }[];
}

/** Worker: deletes every frame whose purge time has passed, for good, from the board and every stored version. */
export async function purgeDue(t: Db): Promise<void> {
  const due = await t.rows<TrashRow & { workshop_id: string; facilitator_id: string }>(
    `SELECT t.*, w.facilitator_id FROM trash_items t JOIN workshops w ON w.id = t.workshop_id
     WHERE t.restored_at IS NULL AND t.purged_at IS NULL AND t.purge_at <= now() FOR UPDATE OF t SKIP LOCKED LIMIT 20`,
  );
  for (const item of due) {
    const images = await t.rows<{ image_id: string }>("SELECT image_id FROM notes WHERE frame_id = $1 AND image_id IS NOT NULL", [item.frame_id]);
    await t.run("DELETE FROM connectors c WHERE EXISTS (SELECT 1 FROM notes n WHERE n.frame_id = $1 AND n.id IN (c.from_note, c.to_note))", [item.frame_id]);
    await t.run("DELETE FROM notes WHERE frame_id = $1", [item.frame_id]);
    await t.run("DELETE FROM clusters WHERE frame_id = $1", [item.frame_id]);
    await t.run("DELETE FROM frames WHERE id = $1", [item.frame_id]);
    const versions = await t.rows<{ id: string; snapshot: Snapshot }>("SELECT id, snapshot FROM versions WHERE workshop_id = $1", [item.workshop_id]);
    for (const v of versions) {
      if (v.snapshot.frames.some((f) => f.id === item.frame_id)) {
        await t.run("UPDATE versions SET snapshot = $2 WHERE id = $1", [v.id, removeFrameFromSnapshot(v.snapshot, item.frame_id)]);
      }
    }
    await t.run("UPDATE trash_items SET purged_at = now() WHERE id = $1", [item.id]);
    await record(t, item.facilitator_id, "frame.purged", item.workshop_id);
    for (const image of images) await releaseImage(t, item.workshop_id, image.image_id);
  }
}
