// Project files: listing, reading, saving with stored save answers, creating, renaming, deleting.
import { createHash } from "node:crypto";
import type pg from "pg";
import { replacedSpan } from "../shared/anchors.ts";
import type { TextFile } from "../shared/api.ts";
import { membership, requireRole } from "./access.ts";
import { signedIn } from "./auth.ts";
import { config } from "./config.ts";
import { pool, query, transaction } from "./db.ts";
import { bytes, fail, ok, type Context, type Reply } from "./http.ts";
import {
  commitRevision,
  currentFile,
  fileShape,
  lockProject,
  newId,
  textFileShape,
  textOf,
  treeAt,
  type TreeFile,
} from "./projects.ts";
import { moveAnchors, orphanAnchors } from "./review.ts";
import { assetKey, getObject } from "./storage.ts";
import { extensionOf, Fields, PATH_MESSAGE, TEXT_EXTENSIONS, textFits, validPath } from "./validate.ts";

const RAW_HEADERS = { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };

export async function readProject(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project, role } = await membership(pool, user.id, ctx.params.pid ?? "");
  const files = await treeAt(pool, project.id, project.revision);
  return ok({
    project: { id: project.id, title: project.title, template: project.template, role, projectRevision: project.revision },
    files: files.map((file) => fileShape(file)),
  });
}

export async function readFile(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project } = await membership(pool, user.id, ctx.params.pid ?? "");
  const file = await currentFile(pool, project.id, project.revision, ctx.params.fid ?? "");
  return ok({ file: file.kind === "text" ? await textFileShape(pool, file) : fileShape(file) });
}

/** Raw bytes: text from its revision, assets from storage (a missing or unreachable object is 503). */
export async function rawBytes(projectId: string, file: TreeFile): Promise<Reply> {
  if (file.kind === "text") {
    return bytes(Buffer.from(await textOf(pool, file.id, file.text_revision ?? 1), "utf8"), "text/plain; charset=utf-8", RAW_HEADERS);
  }
  const data = await getObject(assetKey(projectId, file.id));
  return bytes(data, file.content_type ?? "application/octet-stream", RAW_HEADERS);
}

export async function readRaw(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project } = await membership(pool, user.id, ctx.params.pid ?? "");
  const file = await currentFile(pool, project.id, project.revision, ctx.params.fid ?? "");
  return rawBytes(project.id, file);
}

export async function readRevision(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const { project } = await membership(pool, user.id, ctx.params.pid ?? "");
  const wanted = Number(ctx.params.n);
  if (!/^\d+$/.test(ctx.params.n ?? "") || wanted < 1 || wanted > project.revision) throw fail.notFound();
  const files = await query<{ id: string; path: string; kind: string; size: number; sha256: string }>(
    pool,
    `SELECT t.file_id AS id, t.path, f.kind,
            COALESCE(octet_length(tr.content), f.size)::int AS size,
            COALESCE(encode(sha256(convert_to(tr.content, 'UTF8')), 'hex'), f.sha256) AS sha256
       FROM tree t JOIN files f ON f.id = t.file_id
       LEFT JOIN text_revisions tr ON tr.file_id = t.file_id AND tr.revision = t.text_revision
      WHERE t.project_id = $1 AND t.project_revision = $2 ORDER BY t.path COLLATE "C"`,
    [project.id, wanted],
  );
  return ok({ projectRevision: wanted, files });
}

async function pathTaken(client: pg.PoolClient, projectId: string, revision: number, path: string): Promise<boolean> {
  const row = await client.query("SELECT 1 FROM tree WHERE project_id = $1 AND project_revision = $2 AND path = $3", [
    projectId,
    revision,
    path,
  ]);
  return (row.rowCount ?? 0) > 0;
}

export async function createFile(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  requireRole(access, "write");
  return transaction(async (client) => {
    const project = await lockProject(client, access.project.id);
    const path = ctx.body.path;
    if (typeof path === "string" && validPath(path) && (await pathTaken(client, project.id, project.revision, path))) {
      throw fail.conflict("path_taken");
    }
    const fields = new Fields(ctx.body, ["path", "content"]);
    const checkedPath = fields.string(
      "path",
      PATH_MESSAGE,
      (value) => validPath(value) && (TEXT_EXTENSIONS as readonly string[]).includes(extensionOf(value)),
    );
    const content = fields.string("content", "Text must be at most 1,000,000 bytes.", textFits);
    fields.check();
    const fileId = newId();
    await client.query("INSERT INTO files (id, project_id, kind) VALUES ($1, $2, 'text')", [fileId, project.id]);
    await client.query("INSERT INTO text_revisions (file_id, revision, content) VALUES ($1, 1, $2)", [fileId, content]);
    const revision = await commitRevision(client, project, { kind: "file_create", summary: `Created ${checkedPath}` }, user, [
      { kind: "add", fileId, path: checkedPath, textRevision: 1 },
    ]);
    const file: TextFile = {
      id: fileId,
      path: checkedPath,
      kind: "text",
      revision: 1,
      size: Buffer.byteLength(content, "utf8"),
      content,
    };
    return ok({ file, projectRevision: revision }, 201);
  });
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Stored save answers: one person, one file, one key, kept for IDEMPOTENCY_TTL_SECONDS. */
async function storedAnswer(client: pg.PoolClient, userId: string, fileId: string, key: string, fingerprint: string): Promise<Reply | null> {
  await client.query(
    "DELETE FROM save_answers WHERE user_id = $1 AND file_id = $2 AND key = $3 AND stored_at <= now() - make_interval(secs => $4)",
    [userId, fileId, key, config.idempotencyTtlSeconds],
  );
  const stored = await client.query<{ fingerprint: string; status: number; body: string }>(
    "SELECT fingerprint, status, body FROM save_answers WHERE user_id = $1 AND file_id = $2 AND key = $3",
    [userId, fileId, key],
  );
  const row = stored.rows[0];
  if (!row) return null;
  if (row.fingerprint !== fingerprint) throw fail.conflict("idempotency_key_reused");
  return {
    status: row.status,
    bytes: Buffer.from(row.body, "utf8"),
    contentType: "application/json; charset=utf-8",
    headers: { "Idempotent-Replayed": "true" },
  };
}

async function storeAnswer(client: pg.PoolClient, userId: string, fileId: string, key: string, fingerprint: string, reply: Reply): Promise<Reply> {
  const body = JSON.stringify(reply.body);
  await client.query(
    `INSERT INTO save_answers (user_id, file_id, key, fingerprint, status, body, stored_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id, file_id, key) DO UPDATE SET fingerprint = $4, status = $5, body = $6, stored_at = now()`,
    [userId, fileId, key, fingerprint, reply.status, body],
  );
  return { status: reply.status, bytes: Buffer.from(body, "utf8"), contentType: "application/json; charset=utf-8" };
}

export async function saveFile(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  const fileId = ctx.params.fid ?? "";
  await currentFile(pool, access.project.id, access.project.revision, fileId);
  requireRole(access, "write");
  const key = ctx.req.headers["idempotency-key"];
  if (key !== undefined && (typeof key !== "string" || !KEY_PATTERN.test(key))) {
    throw fail.invalid({ idempotencyKey: "Use 1 to 64 letters, digits, hyphens or underscores." });
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([ctx.body.content ?? null, ctx.body.baseRevision ?? null]))
    .digest("hex");
  return transaction(async (client) => {
    const project = await lockProject(client, access.project.id);
    if (key) {
      const replay = await storedAnswer(client, user.id, fileId, key, fingerprint);
      if (replay) return replay;
    }
    const file = await currentFile(client, project.id, project.revision, fileId);
    const fields = new Fields(ctx.body, ["content", "baseRevision"]);
    const base = ctx.body.baseRevision;
    if (file.kind === "text" && Number.isInteger(base) && base !== file.text_revision) {
      const stale = fail.stale(await textFileShape(client, file));
      const storable = typeof ctx.body.content === "string" && fields.isClean("content");
      if (key && storable) return storeAnswer(client, user.id, fileId, key, fingerprint, { status: 412, body: stale.body });
      throw stale;
    }
    const content = fields.string("content", "Text must be at most 1,000,000 bytes.", textFits);
    fields.integer("baseRevision", "Name the revision this text was based on.", (value) => value >= 1);
    if (file.kind === "asset") fields.reject("content", "Figures cannot be edited as text.");
    fields.check();
    const before = await textOf(client, file.id, file.text_revision ?? 1);
    const revision = await commitRevision(client, project, { kind: "save", summary: `Saved ${file.path}` }, user, [
      { kind: "text", fileId, content },
    ]);
    await moveAnchors(client, fileId, replacedSpan(before, content));
    const saved = await currentFile(client, project.id, revision, fileId);
    const reply = ok({ file: fileShape(saved, content), projectRevision: revision });
    return key ? storeAnswer(client, user.id, fileId, key, fingerprint, reply) : reply;
  });
}

export async function renameFile(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  await currentFile(pool, access.project.id, access.project.revision, ctx.params.fid ?? "");
  requireRole(access, "write");
  return transaction(async (client) => {
    const project = await lockProject(client, access.project.id);
    const file = await currentFile(client, project.id, project.revision, ctx.params.fid ?? "");
    const path = ctx.body.path;
    if (typeof path === "string" && path !== file.path && validPath(path) && (await pathTaken(client, project.id, project.revision, path))) {
      throw fail.conflict("path_taken");
    }
    const fields = new Fields(ctx.body, ["path"]);
    const target = fields.string("path", PATH_MESSAGE, (value) => validPath(value) && extensionOf(value) === extensionOf(file.path));
    fields.check();
    const revision = await commitRevision(
      client,
      project,
      { kind: "file_rename", summary: `Renamed ${file.path} to ${target}` },
      user,
      [{ kind: "rename", fileId: file.id, path: target }],
    );
    const renamed = await currentFile(client, project.id, revision, file.id);
    return ok({ file: renamed.kind === "text" ? await textFileShape(client, renamed) : fileShape(renamed), projectRevision: revision });
  });
}

export async function deleteFile(ctx: Context): Promise<Reply> {
  const user = await signedIn(ctx);
  const access = await membership(pool, user.id, ctx.params.pid ?? "");
  await currentFile(pool, access.project.id, access.project.revision, ctx.params.fid ?? "");
  requireRole(access, "write");
  return transaction(async (client) => {
    const project = await lockProject(client, access.project.id);
    const file = await currentFile(client, project.id, project.revision, ctx.params.fid ?? "");
    const revision = await commitRevision(client, project, { kind: "file_delete", summary: `Deleted ${file.path}` }, user, [
      { kind: "remove", fileId: file.id },
    ]);
    await orphanAnchors(client, [file.id]);
    return ok({ projectRevision: revision });
  });
}
