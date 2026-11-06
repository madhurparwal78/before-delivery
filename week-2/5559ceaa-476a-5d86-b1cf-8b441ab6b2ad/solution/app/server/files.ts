import { randomUUID } from "node:crypto";
import type pg from "pg";
import { sha256Hex } from "./storage.js";
import { many, one, pool, tx } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { broadcast } from "./hub.js";
import { contentMessage, contentProblem, normalisePath, pathMessage, pathProblem } from "./paths.js";
import { checkWrite, lockProject } from "./rules.js";
import { FILE_COLUMNS, type FileRow, fileView, projectRole } from "./views.js";

export async function bumpEpoch(db: pg.PoolClient, projectId: string): Promise<number> {
  const row = await one<{ file_epoch: string }>(
    db,
    "UPDATE projects SET file_epoch = file_epoch + 1 WHERE id = $1 RETURNING file_epoch",
    [projectId],
  );
  return Number(row!.file_epoch);
}

export async function audit(
  db: pg.PoolClient,
  projectId: string,
  actorId: string,
  type: string,
  subject: Record<string, unknown>,
): Promise<void> {
  await db.query("INSERT INTO audit_events (id, project_id, type, actor_id, subject) VALUES ($1, $2, $3, $4, $5)", [
    randomUUID(),
    projectId,
    type,
    actorId,
    JSON.stringify(subject),
  ]);
}

async function logEdit(db: pg.PoolClient, projectId: string, userId: string, action: string, file: FileRow | { id: string; revision: number; sha256: string | null }): Promise<void> {
  await db.query(
    "INSERT INTO edit_log (project_id, file_id, user_id, action, revision, sha256) VALUES ($1, $2, $3, $4, $5, $6)",
    [projectId, file.id, userId, action, file.revision, file.sha256],
  );
}

function checkedPath(raw: unknown, field: string): string {
  if (typeof raw !== "string" || raw.trim() === "") throw invalid({ [field]: "Enter a file path." });
  return normalisePath(raw);
}

function validPath(path: string, field: string): void {
  const problem = pathProblem(path);
  if (problem) throw invalid({ [field]: pathMessage(problem) });
}

function contentBytes(path: string, raw: unknown): Buffer {
  if (typeof raw !== "string") throw invalid({ content: "Content must be text." });
  const bytes = Buffer.from(raw, "utf8");
  const problem = contentProblem(path, bytes);
  if (problem) throw invalid({ content: contentMessage(problem) });
  return bytes;
}

async function liveFile(db: pg.PoolClient, projectId: string, fileId: string, lock = false): Promise<FileRow> {
  const row = await one<FileRow>(
    db,
    `SELECT ${FILE_COLUMNS} FROM files WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    [fileId, projectId],
  );
  if (!row) throw new ApiError("not_found");
  return row;
}

async function pathTaken(db: pg.PoolClient, projectId: string, path: string, except: string[] = []): Promise<boolean> {
  return !!(await one(
    db,
    "SELECT 1 FROM files WHERE project_id = $1 AND path = $2 AND deleted_at IS NULL AND NOT (id = ANY($3::uuid[]))",
    [projectId, path, except],
  ));
}

export async function createFile(projectId: string, userId: string, body: Record<string, unknown>): Promise<FileRow> {
  const file = await tx(async (db) => {
    await projectRole(db, projectId, userId);
    await checkWrite(db, projectId, userId);
    const path = checkedPath(body.path, "path");
    if (await pathTaken(db, projectId, path)) throw new ApiError("path_taken", { path });
    validPath(path, "path");
    const bytes = contentBytes(path, body.content);
    const row = await one<FileRow>(
      db,
      `INSERT INTO files (id, project_id, path, content, sha256, size) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${FILE_COLUMNS}`,
      [randomUUID(), projectId, path, bytes, sha256Hex(bytes), bytes.length],
    );
    await logEdit(db, projectId, userId, "create", row!);
    await bumpEpoch(db, projectId);
    return fileView(row!);
  });
  broadcast(projectId, { type: "file", file });
  return file;
}

/** A content save, judged the same for HTTP PUT and socket edit frames. */
export async function saveFile(
  projectId: string,
  fileId: string,
  userId: string,
  content: unknown,
  baseRevision: unknown,
): Promise<FileRow> {
  const file = await tx(async (db) => {
    await projectRole(db, projectId, userId);
    const current = await liveFile(db, projectId, fileId);
    await checkWrite(db, projectId, userId);
    const locked = await liveFile(db, projectId, current.id, true);
    if (typeof baseRevision !== "number" || !Number.isInteger(baseRevision)) {
      throw invalid({ base_revision: "Send the revision this change is based on." });
    }
    if (baseRevision !== locked.revision) throw new ApiError("stale_revision", { current_revision: locked.revision });
    const bytes = contentBytes(locked.path, content);
    const sha = sha256Hex(bytes);
    const row = await one<FileRow>(
      db,
      `UPDATE files SET content = $2, sha256 = $3, size = $4, revision = revision + 1 WHERE id = $1 RETURNING ${FILE_COLUMNS}`,
      [locked.id, bytes, sha, bytes.length],
    );
    await logEdit(db, projectId, userId, "save", row!);
    await bumpEpoch(db, projectId);
    return fileView(row!);
  });
  broadcast(projectId, { type: "file", file });
  return file;
}

export async function currentRevision(projectId: string, fileId: string): Promise<number | null> {
  const row = await one<{ revision: number }>(
    pool,
    "SELECT revision FROM files WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL",
    [fileId, projectId],
  );
  return row?.revision ?? null;
}

export async function renameFile(projectId: string, fileId: string, userId: string, body: Record<string, unknown>): Promise<FileRow> {
  const file = await tx(async (db) => {
    const role = await projectRole(db, projectId, userId);
    const current = await liveFile(db, projectId, fileId);
    if (role !== "mentor") throw new ApiError("forbidden");
    await lockProject(db, projectId);
    const path = checkedPath(body.path, "path");
    if (path === current.path) return current;
    if (await pathTaken(db, projectId, path, [current.id])) throw new ApiError("path_taken", { path });
    validPath(path, "path");
    const row = await one<FileRow>(db, `UPDATE files SET path = $2 WHERE id = $1 RETURNING ${FILE_COLUMNS}`, [current.id, path]);
    await audit(db, projectId, userId, "file_renamed", { file_id: current.id, from: current.path, to: path });
    await bumpEpoch(db, projectId);
    return fileView(row!);
  });
  broadcast(projectId, { type: "file", file });
  return file;
}

export async function renameFolder(projectId: string, userId: string, body: Record<string, unknown>): Promise<FileRow[]> {
  const files = await tx(async (db) => {
    const role = await projectRole(db, projectId, userId);
    if (role !== "mentor") throw new ApiError("forbidden");
    await lockProject(db, projectId);
    const from = checkedPath(body.from, "from").replace(/\/+$/, "");
    const to = checkedPath(body.to, "to").replace(/\/+$/, "");
    const moving = await many<FileRow>(
      db,
      `SELECT ${FILE_COLUMNS} FROM files WHERE project_id = $1 AND deleted_at IS NULL AND starts_with(path, $2) ORDER BY path COLLATE "C" FOR UPDATE`,
      [projectId, `${from}/`],
    );
    const targets = moving.map((f) => ({ file: f, path: `${to}/${f.path.slice(from.length + 1)}` }));
    const ids = moving.map((f) => f.id);
    for (const target of targets) {
      if (await pathTaken(db, projectId, target.path, ids)) throw new ApiError("path_taken", { path: target.path });
    }
    if (moving.length === 0) throw invalid({ from: "No file sits under that folder." });
    for (const target of targets) validPath(target.path, "to");
    if (from === to) return moving.map(fileView);
    await db.query("UPDATE files SET path = chr(1) || id::text WHERE id = ANY($1::uuid[])", [ids]);
    const moved: FileRow[] = [];
    for (const target of targets) {
      const row = await one<FileRow>(db, `UPDATE files SET path = $2 WHERE id = $1 RETURNING ${FILE_COLUMNS}`, [target.file.id, target.path]);
      moved.push(fileView(row!));
      await audit(db, projectId, userId, "file_renamed", { file_id: target.file.id, from: target.file.path, to: target.path });
    }
    await bumpEpoch(db, projectId);
    return moved;
  });
  for (const file of files) broadcast(projectId, { type: "file", file });
  return files;
}

export async function deleteFile(projectId: string, fileId: string, userId: string): Promise<void> {
  await tx(async (db) => {
    await projectRole(db, projectId, userId);
    const current = await liveFile(db, projectId, fileId);
    await checkWrite(db, projectId, userId);
    await db.query("UPDATE files SET deleted_at = now() WHERE id = $1", [current.id]);
    await logEdit(db, projectId, userId, "delete", { id: current.id, revision: current.revision, sha256: null });
    await audit(db, projectId, userId, "file_deleted", { file_id: current.id, path: current.path });
    await bumpEpoch(db, projectId);
  });
  broadcast(projectId, { type: "file_deleted", file_id: fileId });
}
