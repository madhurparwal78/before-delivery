import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  advanceCheckpoint,
  announceCheckpoint,
  announceFileSet,
  applyFileSet,
  captureCheckpoint,
  readRecorded,
  recordedFiles,
  requireSaved,
} from "../checkpoints.js";
import { many, one, pool, tx } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { audit, bumpEpoch } from "../files.js";
import { ok, route } from "../http.js";
import { checkWrite } from "../rules.js";
import {
  CHECKPOINT_SELECT,
  checkpointById,
  type CheckpointRow,
  checkpointView,
  FILE_COLUMNS,
  type FileRow,
  projectRole,
} from "../views.js";

export async function visibleCheckpoint(db: pg.Pool | pg.PoolClient, id: string, userId: string): Promise<CheckpointRow> {
  const checkpoint = await checkpointById(db, id);
  if (!checkpoint) throw new ApiError("not_found");
  await projectRole(db, checkpoint.project_id, userId);
  return checkpoint;
}

async function liveFiles(db: pg.PoolClient, projectId: string): Promise<FileRow[]> {
  return many<FileRow>(db, `SELECT ${FILE_COLUMNS} FROM files WHERE project_id = $1 AND deleted_at IS NULL ORDER BY path COLLATE "C"`, [
    projectId,
  ]);
}

route("POST", "/api/projects/:project_id/checkpoints", async (ctx) => {
  const projectId = ctx.params.project_id!;
  await projectRole(pool, projectId, ctx.user.id);
  const raw = ctx.json().name;
  const name = typeof raw === "string" ? raw.trim() : "";
  if ([...name].length < 1 || [...name].length > 80) throw invalid({ name: "Give the checkpoint a name of 1 to 80 characters." });
  const id = await tx((db) => captureCheckpoint(db, projectId, ctx.user.id, name));
  await announceCheckpoint(id);
  await advanceCheckpoint(id);
  const checkpoint = (await checkpointById(pool, id))!;
  return ok({ checkpoint: checkpointView(checkpoint) }, checkpoint.state === "saved" ? 201 : 202);
});

route("GET", "/api/projects/:project_id/checkpoints", async (ctx) => {
  const projectId = ctx.params.project_id!;
  await projectRole(pool, projectId, ctx.user.id);
  const rows = await many<CheckpointRow>(pool, `${CHECKPOINT_SELECT} WHERE c.project_id = $1 ORDER BY c.created_at DESC, c.seq DESC`, [
    projectId,
  ]);
  return ok({ checkpoints: rows.map(checkpointView) });
});

route("GET", "/api/checkpoints/:checkpoint_id", async (ctx) => {
  const checkpoint = await visibleCheckpoint(pool, ctx.params.checkpoint_id!, ctx.user.id);
  const files = await many(
    pool,
    `SELECT cf.file_id, cf.path, f.path AS current_path, cf.sha256, cf.size FROM checkpoint_files cf
     LEFT JOIN files f ON f.id = cf.file_id AND f.deleted_at IS NULL WHERE cf.checkpoint_id = $1 ORDER BY cf.path COLLATE "C"`,
    [checkpoint.id],
  );
  return ok({ checkpoint: { ...checkpointView(checkpoint), files } });
});

route("GET", "/api/checkpoints/:checkpoint_id/files/:file_id", async (ctx) => {
  const checkpoint = await visibleCheckpoint(pool, ctx.params.checkpoint_id!, ctx.user.id);
  const file = (await recordedFiles(pool, checkpoint.id)).find((f) => f.file_id === ctx.params.file_id);
  if (!file) throw new ApiError("not_found");
  requireSaved(checkpoint.state);
  const bytes = (await readRecorded(checkpoint.project_id, [file])).get(file.file_id)!;
  return ok({ file: { file_id: file.file_id, path: file.path, content: bytes.toString("utf8"), sha256: file.sha256 } });
});

route("POST", "/api/checkpoints/:checkpoint_id/restore", async (ctx) => {
  const checkpoint = await visibleCheckpoint(pool, ctx.params.checkpoint_id!, ctx.user.id);
  const outcome = await tx(async (db) => {
    await checkWrite(db, checkpoint.project_id, ctx.user.id);
    requireSaved(checkpoint.state);
    const recorded = await recordedFiles(db, checkpoint.id);
    const bytes = await readRecorded(checkpoint.project_id, recorded);
    const restoreId = randomUUID();
    await db.query("DELETE FROM restore_files USING restores r WHERE r.id = restore_files.restore_id AND r.project_id = $1", [
      checkpoint.project_id,
    ]);
    await db.query(
      "INSERT INTO restores (id, project_id, checkpoint_id, checkpoint_name, user_id, state, epoch_after) VALUES ($1, $2, $3, $4, $5, 'applied', 0)",
      [restoreId, checkpoint.project_id, checkpoint.id, checkpoint.name, ctx.user.id],
    );
    await db.query(
      `INSERT INTO restore_files (restore_id, file_id, path, content)
       SELECT $1, id, path, content FROM files WHERE project_id = $2 AND deleted_at IS NULL`,
      [restoreId, checkpoint.project_id],
    );
    const change = await applyFileSet(
      db,
      checkpoint.project_id,
      ctx.user.id,
      "restore",
      recorded.map((f) => ({ file_id: f.file_id, path: f.path, content: bytes.get(f.file_id)! })),
    );
    const epoch = await bumpEpoch(db, checkpoint.project_id);
    await db.query("UPDATE restores SET epoch_after = $2 WHERE id = $1", [restoreId, epoch]);
    await audit(db, checkpoint.project_id, ctx.user.id, "checkpoint_restored", {
      restore_id: restoreId,
      checkpoint_id: checkpoint.id,
      checkpoint_name: checkpoint.name,
    });
    return { restoreId, change, files: await liveFiles(db, checkpoint.project_id) };
  });
  announceFileSet(checkpoint.project_id, outcome.change);
  return ok({ restore: { id: outcome.restoreId, checkpoint_id: checkpoint.id, state: "applied" }, files: outcome.files });
});

route("POST", "/api/restores/:restore_id/undo", async (ctx) => {
  const found = await one<{ project_id: string }>(pool, "SELECT project_id FROM restores WHERE id = $1", [ctx.params.restore_id]);
  if (!found) throw new ApiError("not_found");
  await projectRole(pool, found.project_id, ctx.user.id);
  const outcome = await tx(async (db) => {
    await checkWrite(db, found.project_id, ctx.user.id);
    const restore = (await one<{ id: string; checkpoint_id: string | null; checkpoint_name: string; state: string; epoch_after: string }>(
      db,
      "SELECT id, checkpoint_id, checkpoint_name, state, epoch_after FROM restores WHERE id = $1 FOR UPDATE",
      [ctx.params.restore_id],
    ))!;
    if (restore.state === "undone") throw new ApiError("restore_already_undone");
    const epoch = (await one<{ file_epoch: string }>(db, "SELECT file_epoch FROM projects WHERE id = $1", [found.project_id]))!;
    if (epoch.file_epoch !== restore.epoch_after) throw new ApiError("restore_superseded");
    const saved = await many<{ file_id: string; path: string; content: Buffer }>(
      db,
      "SELECT file_id, path, content FROM restore_files WHERE restore_id = $1",
      [restore.id],
    );
    const change = await applyFileSet(db, found.project_id, ctx.user.id, "undo", saved);
    await bumpEpoch(db, found.project_id);
    await db.query("UPDATE restores SET state = 'undone' WHERE id = $1", [restore.id]);
    await db.query("DELETE FROM restore_files WHERE restore_id = $1", [restore.id]);
    await audit(db, found.project_id, ctx.user.id, "restore_undone", {
      restore_id: restore.id,
      checkpoint_id: restore.checkpoint_id,
      checkpoint_name: restore.checkpoint_name,
    });
    return { restore, change, files: await liveFiles(db, found.project_id) };
  });
  announceFileSet(found.project_id, outcome.change);
  return ok({
    restore: { id: outcome.restore.id, checkpoint_id: outcome.restore.checkpoint_id, state: "undone" },
    files: outcome.files,
  });
});
