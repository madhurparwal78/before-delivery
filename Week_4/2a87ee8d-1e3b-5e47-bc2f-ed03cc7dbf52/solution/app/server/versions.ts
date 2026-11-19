// Version history: the committed version counter, autosave snapshots and undoable restores.
import { newId, notify, type Db } from "./db.js";
import { fail } from "./errors.js";
import { record } from "./activity.js";
import { releaseImage } from "./images.js";
import { liveTrash, trashFrame, type Snapshot } from "./trash.js";
import type { VersionReason } from "../shared/copy.js";

const NOTE_COLUMNS = [
  "id", "frame_id", "cluster_id", "cluster_index", "kind", "text", "image_id", "x", "y", "revealed",
  "facilitator_only", "author_participant_id", "round", "created_at", "seq",
] as const;

async function takeSnapshot(t: Db, workshopId: string): Promise<Snapshot> {
  const frames = await t.rows<Snapshot["frames"][number]>(
    "SELECT id, title, x, y, width, height, position FROM frames WHERE workshop_id = $1 AND trash_id IS NULL ORDER BY position",
    [workshopId],
  );
  const ids = frames.map((f) => f.id);
  const notes = await t.rows<Snapshot["notes"][number]>(
    `SELECT ${NOTE_COLUMNS.join(", ")} FROM notes WHERE workshop_id = $1 AND frame_id IN (SELECT jsonb_array_elements_text($2::jsonb)) ORDER BY seq`,
    [workshopId, ids],
  );
  const clusters = await t.rows<Snapshot["clusters"][number]>(
    "SELECT id, frame_id, title, x, y, created_at, seq FROM clusters WHERE workshop_id = $1 AND frame_id IN (SELECT jsonb_array_elements_text($2::jsonb)) ORDER BY seq",
    [workshopId, ids],
  );
  const noteIds = new Set(notes.map((n) => n.id));
  const connectors = (
    await t.rows<Snapshot["connectors"][number]>("SELECT id, from_note, to_note FROM connectors WHERE workshop_id = $1 ORDER BY seq", [workshopId])
  ).filter((c) => noteIds.has(c.from_note) && noteIds.has(c.to_note));
  return { frames, notes, clusters, connectors };
}

async function writeVersion(t: Db, workshopId: string, version: number, reason: VersionReason) {
  const id = newId();
  await t.run("INSERT INTO versions (id, workshop_id, version, reason, snapshot) VALUES ($1, $2, $3, $4, $5)", [
    id,
    workshopId,
    version,
    reason,
    await takeSnapshot(t, workshopId),
  ]);
  return { id, version };
}

/** Raises the version once for an applied operation, autosaves at multiples of 50 and fans the change out. */
export async function commit(t: Db, workshopId: string): Promise<number> {
  const row = await t.one<{ version: number }>("UPDATE workshops SET version = version + 1 WHERE id = $1 RETURNING version", [workshopId]);
  if (!row) fail("not_found");
  if (row.version % 50 === 0) await writeVersion(t, workshopId, row.version, "auto");
  await notify(t, { t: "board", w: workshopId, v: row.version });
  return row.version;
}

export async function closeVersion(t: Db, workshopId: string, version: number): Promise<void> {
  await writeVersion(t, workshopId, version, "close");
}

export async function listVersions(t: Db, workshopId: string) {
  const rows = await t.rows<{ id: string; version: number; reason: VersionReason; created_at: Date; note_count: number }>(
    `SELECT id, version, reason, created_at,
       (SELECT count(*) FROM jsonb_array_elements(snapshot->'notes') n WHERE NOT (n->>'facilitator_only')::boolean) AS note_count
     FROM versions WHERE workshop_id = $1 ORDER BY created_at DESC, version DESC`,
    [workshopId],
  );
  return rows.map((r) => ({ id: r.id, version: r.version, reason: r.reason, createdAt: r.created_at.toISOString(), noteCount: r.note_count }));
}

export async function findVersion(t: Db, workshopId: string, versionId: string) {
  return t.one<{ id: string; version: number; snapshot: Snapshot }>("SELECT id, version, snapshot FROM versions WHERE id = $1 AND workshop_id = $2", [
    versionId,
    workshopId,
  ]);
}

/** Restores a snapshot as one new change, after saving the current board as a before_restore version. */
export async function restoreVersion(t: Db, workshop: { id: string; facilitator_id: string; version: number; status: string }, snapshot: Snapshot) {
  const saved = await writeVersion(t, workshop.id, workshop.version, "before_restore");
  const current = await t.rows<{ id: string; title: string; trash_id: string | null; live: boolean | null }>(
    `SELECT f.id, f.title, f.trash_id, ${liveTrash("t")} AS live FROM frames f LEFT JOIN trash_items t ON t.id = f.trash_id WHERE f.workshop_id = $1`,
    [workshop.id],
  );
  const byId = new Map(current.map((f) => [f.id, f]));
  const wanted = new Set(snapshot.frames.map((f) => f.id));
  for (const frame of current) if (frame.trash_id === null && !wanted.has(frame.id)) await trashFrame(t, workshop.id, frame);
  const restored = new Set<string>();
  for (const f of snapshot.frames) {
    const now = byId.get(f.id);
    if (!now || (now.trash_id !== null && !now.live)) continue;
    if (now.trash_id !== null) await t.run("UPDATE trash_items SET restored_at = now() WHERE id = $1", [now.trash_id]);
    await t.run("UPDATE frames SET title = $2, x = $3, y = $4, width = $5, height = $6, position = $7, trash_id = NULL WHERE id = $1", [
      f.id, f.title, f.x, f.y, f.width, f.height, f.position,
    ]);
    restored.add(f.id);
  }
  const frameIds = [...restored];
  const keepNotes = snapshot.notes.filter((n) => restored.has(n.frame_id));
  const keepIds = keepNotes.map((n) => n.id);
  const dropped = await t.rows<{ id: string; image_id: string | null }>(
    `DELETE FROM notes WHERE workshop_id = $1 AND frame_id IN (SELECT jsonb_array_elements_text($2::jsonb))
     AND id NOT IN (SELECT jsonb_array_elements_text($3::jsonb)) RETURNING id, image_id`,
    [workshop.id, frameIds, keepIds],
  );
  await t.run(
    `DELETE FROM connectors c WHERE c.workshop_id = $1 AND EXISTS (
       SELECT 1 FROM notes n WHERE n.id IN (c.from_note, c.to_note) AND n.frame_id IN (SELECT jsonb_array_elements_text($2::jsonb)))
     OR c.from_note IN (SELECT jsonb_array_elements_text($3::jsonb)) OR c.to_note IN (SELECT jsonb_array_elements_text($3::jsonb))`,
    [workshop.id, frameIds, dropped.map((d) => d.id)],
  );
  await t.run(
    `DELETE FROM clusters WHERE workshop_id = $1 AND frame_id IN (SELECT jsonb_array_elements_text($2::jsonb))
     AND id NOT IN (SELECT jsonb_array_elements_text($3::jsonb))`,
    [workshop.id, frameIds, snapshot.clusters.filter((c) => restored.has(c.frame_id)).map((c) => c.id)],
  );
  for (const c of snapshot.clusters.filter((c) => restored.has(c.frame_id))) {
    await t.run(
      `INSERT INTO clusters (id, workshop_id, frame_id, title, x, y, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET frame_id = $3, title = $4, x = $5, y = $6`,
      [c.id, workshop.id, c.frame_id, String(c.title), Number(c.x), Number(c.y), String(c.created_at)],
    );
  }
  const reveal = workshop.status === "revealed";
  for (const n of keepNotes) {
    await t.run(
      `INSERT INTO notes (id, workshop_id, frame_id, cluster_id, cluster_index, kind, text, image_id, x, y, revealed, facilitator_only,
                          author_participant_id, round, created_at, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (id) DO UPDATE SET frame_id = $3, cluster_id = $4, cluster_index = $5, text = $7, x = $9, y = $10,
         revealed = $11, facilitator_only = $12`,
      [
        n.id, workshop.id, n.frame_id, (n.cluster_id as string | null) ?? null, (n.cluster_index as number | null) ?? null, String(n.kind),
        (n.text as string | null) ?? null, n.image_id, Number(n.x), Number(n.y), reveal || Boolean(n.revealed), Boolean(n.facilitator_only),
        (n.author_participant_id as string | null) ?? null, Number(n.round), String(n.created_at), Number(n.seq),
      ],
    );
  }
  const present = new Set((await t.rows<{ id: string }>("SELECT id FROM notes WHERE workshop_id = $1", [workshop.id])).map((r) => r.id));
  for (const c of snapshot.connectors) {
    if (!present.has(c.from_note) || !present.has(c.to_note)) continue;
    await t.run("INSERT INTO connectors (id, workshop_id, from_note, to_note) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING", [
      c.id, workshop.id, c.from_note, c.to_note,
    ]);
  }
  for (const d of dropped) if (d.image_id) await releaseImage(t, workshop.id, d.image_id);
  await record(t, workshop.facilitator_id, "version.restored", workshop.id);
  await commit(t, workshop.id);
  return saved;
}
