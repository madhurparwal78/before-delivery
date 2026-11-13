import { codePoints } from "../shared/codepoints";
import { FIELD_ERRORS } from "../shared/copy";
import { NAME_MAX } from "../shared/limits";
import type { Clip, Cut } from "../shared/types";
import type { Actor } from "./access";
import { one, pool, query, tx, type Db } from "./db";
import { AppError, invalid, notFound } from "./errors";
import { newId } from "./ids";
import { publicCaption, publicRow } from "./records";
import { Draft, timelineLength } from "./timeline/model";
import type { CutSnapshot } from "./timeline/engine";
import { loadProjectRow, loadTimeline } from "./timeline/store";

interface CutRow {
  id: string;
  name: string;
  version: number;
  total_frames: number;
  shared: boolean;
  created_at: Date;
}

async function cutRecord(db: Db, row: CutRow): Promise<Cut> {
  const approvals = await query<{ name: string; at: Date }>("SELECT name, at FROM approvals WHERE cut_id = $1 ORDER BY id", [row.id], db);
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    total_frames: row.total_frames,
    shared: row.shared,
    approvals: approvals.map((approval) => ({ name: approval.name, at: approval.at.toISOString() })),
    created_at: row.created_at.toISOString(),
  };
}

export async function listCuts(projectId: string): Promise<Cut[]> {
  const rows = await query<CutRow>("SELECT id, name, version, total_frames, shared, created_at FROM cuts WHERE project_id = $1 ORDER BY seq", [projectId]);
  return Promise.all(rows.map((row) => cutRecord(pool, row)));
}

export async function cutById(db: Db, projectId: string, cutId: string): Promise<Cut> {
  const row = await one<CutRow>("SELECT id, name, version, total_frames, shared, created_at FROM cuts WHERE id = $1 AND project_id = $2", [cutId, projectId], db);
  if (!row) throw notFound();
  return cutRecord(db, row);
}

/** A named cut: a read-only snapshot of the timeline at the current version. */
export async function nameCut(projectId: string, raw: unknown): Promise<Cut> {
  const name = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["name"] : undefined;
  if (typeof name !== "string" || name.trim().length === 0 || codePoints(name) > NAME_MAX) throw invalid({ name: FIELD_ERRORS.cutName });
  const id = newId("k");
  try {
    await tx(async (db) => {
      const project = await loadProjectRow(db, projectId, true);
      if (!project) throw notFound();
      const timeline = await loadTimeline(db, project);
      const snapshot: CutSnapshot = { rows: timeline.rows, clips: timeline.clips, captions: timeline.captions };
      await db.query(
        "INSERT INTO cuts (id, project_id, name, version, total_frames, snapshot) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, projectId, name, project.version, timelineLength(new Draft(timeline)), JSON.stringify(snapshot)],
      );
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new AppError("cut_name_taken", { cut: name });
    throw error;
  }
  return cutById(pool, projectId, id);
}

export async function cutSnapshot(projectId: string, cutId: string) {
  const row = await one<{ snapshot: CutSnapshot } & CutRow>("SELECT * FROM cuts WHERE id = $1 AND project_id = $2", [cutId, projectId]);
  if (!row) throw notFound();
  return { cut: await cutRecord(pool, row), rows: row.snapshot.rows.map(publicRow), clips: row.snapshot.clips, captions: row.snapshot.captions.map(publicCaption) };
}

interface Place {
  row_id: string;
  start_frame: number;
  end_frame: number;
}

const place = (clip: Clip): Place => ({ row_id: clip.row_id, start_frame: clip.start_frame, end_frame: clip.end_frame });

/** Two cuts as lists of added, removed and changed clips by frame. */
export async function compareCuts(projectId: string, fromId: string, toId: string) {
  const [from, to] = await Promise.all([cutSnapshot(projectId, fromId), cutSnapshot(projectId, toId)]);
  const before = new Map(from.clips.map((clip) => [clip.id, clip]));
  const after = new Map(to.clips.map((clip) => [clip.id, clip]));
  const changed = to.clips.flatMap((clip) => {
    const old = before.get(clip.id);
    if (!old || JSON.stringify(place(old)) === JSON.stringify(place(clip))) return [];
    return [{ clip_id: clip.id, from: place(old), to: place(clip) }];
  });
  return {
    added: to.clips.filter((clip) => !before.has(clip.id)).map((clip) => clip.id),
    removed: from.clips.filter((clip) => !after.has(clip.id)).map((clip) => clip.id),
    changed,
    frame_delta: to.cut.total_frames - from.cut.total_frames,
  };
}

export async function approve(projectId: string, cutId: string, actor: Actor): Promise<{ cut_id: string; approvals: Cut["approvals"] }> {
  const cut = await cutById(pool, projectId, cutId);
  await query("INSERT INTO approvals (cut_id, name) VALUES ($1,$2) ON CONFLICT (cut_id, name) DO NOTHING", [cutId, actor.name]);
  return { cut_id: cut.id, approvals: (await cutById(pool, projectId, cutId)).approvals };
}
