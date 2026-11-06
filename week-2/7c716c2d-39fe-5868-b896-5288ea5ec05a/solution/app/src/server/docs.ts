// Versioned docs: a save lands only on the version it was made from; text is stored as submitted.
import { randomUUID } from "node:crypto";
import { canSeeProject, visibleProjectIds, type Viewer } from "./access.js";
import { attachmentsOf } from "./attachments.js";
import { tx, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import { emit } from "./events.js";
import { route } from "./router.js";
import { textWithin } from "../shared/text.js";
import { isoInstant, nowMs } from "./time.js";
import { zoneOf } from "./workspace.js";

interface DocRow {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: string;
  updated_at: number;
}

async function docJson(db: Db, workspaceId: string, rows: DocRow[], withBody: boolean): Promise<Record<string, unknown>[]> {
  const zone = await zoneOf(db, workspaceId);
  const attachments = await attachmentsOf(db, "doc", rows.map((r) => r.id));
  return rows.map((d) => ({
    id: d.id,
    project_id: d.project_id,
    title: d.title,
    ...(withBody ? { body: d.body } : {}),
    version: d.version,
    updated_by: d.updated_by,
    updated_at: isoInstant(d.updated_at, zone),
    attachments: attachments.get(d.id) ?? [],
  }));
}

async function findDoc(db: Db, viewer: Viewer, id: string): Promise<DocRow> {
  const { rows } = await db.query<DocRow>(
    "SELECT id, project_id, title, body, version, updated_by, updated_at FROM docs WHERE id::text = $1 AND workspace_id = $2 AND project_id = ANY($3)",
    [id, viewer.workspaceId, await visibleProjectIds(db, viewer)],
  );
  if (!rows[0]) throw new ApiError("not_found");
  return rows[0];
}

function textFields(body: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!textWithin(body.title, 1, 200)) fields.title = "Give the doc a title of up to 200 characters.";
  if (!textWithin(body.body, 0, 200_000)) fields.body = "A doc can be up to 200,000 characters.";
  return fields;
}

route("GET", "/api/docs", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const { rows } = await db.query<DocRow>(
        "SELECT id, project_id, title, body, version, updated_by, updated_at FROM docs WHERE workspace_id = $1 AND project_id = ANY($2) ORDER BY lower(title), id",
        [viewer.workspaceId, await visibleProjectIds(db, viewer)],
      );
      return { docs: await docJson(db, viewer.workspaceId, rows, false) };
    }),
  };
});

route("GET", "/api/docs/:id", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return { status: 200, body: await tx(async (db) => (await docJson(db, viewer.workspaceId, [await findDoc(db, viewer, ctx.params.id ?? "")], true))[0]) };
});

function memberOnly(viewer: Viewer): void {
  if (viewer.role === "guest") throw new ApiError("forbidden");
}

/** Records `row` as a stored version and tells everyone who shares the project. */
async function versionSaved(db: Db, workspaceId: string, row: DocRow): Promise<Record<string, unknown>> {
  await db.query("INSERT INTO doc_versions (doc_id, version, title, body, saved_by, saved_at) VALUES ($1, $2, $3, $4, $5, $6)", [row.id, row.version, row.title, row.body, row.updated_by, row.updated_at]);
  await emit(db, workspaceId, "doc", { id: row.id, project_id: row.project_id, version: row.version, updated_by: row.updated_by }, { projectId: row.project_id });
  return (await docJson(db, workspaceId, [row], true))[0] as Record<string, unknown>;
}

/** Writes the next version when `base` is still the stored one; any other base changes nothing. */
async function saveOnto(db: Db, viewer: Viewer, doc: DocRow, base: number, title: unknown, body: unknown): Promise<Record<string, unknown>> {
  const { rows } = await db.query<DocRow>(
    `UPDATE docs SET title = $3, body = $4, version = version + 1, updated_by = $5, updated_at = $6
     WHERE id = $1 AND version = $2 RETURNING id, project_id, title, body, version, updated_by, updated_at`,
    [doc.id, base, title, body, viewer.id, nowMs()],
  );
  if (rows[0]) return versionSaved(db, viewer.workspaceId, rows[0]);
  const current = await findDoc(db, viewer, doc.id);
  throw new ApiError("version_conflict", null, { current: (await docJson(db, viewer.workspaceId, [current], true))[0] });
}

route("POST", "/api/docs", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const projectId = ctx.body.project_id;
    if (typeof projectId !== "string" || !(await canSeeProject(db, viewer, projectId))) throw new ApiError("not_found");
    memberOnly(viewer);
    const fields = textFields(ctx.body);
    if (Object.keys(fields).length) throw invalid(fields);
    const { rows } = await db.query<DocRow>(
      `INSERT INTO docs (id, workspace_id, project_id, title, body, version, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
       RETURNING id, project_id, title, body, version, updated_by, updated_at`,
      [randomUUID(), viewer.workspaceId, projectId, ctx.body.title, ctx.body.body, viewer.id, nowMs()],
    );
    return { status: 201, body: await versionSaved(db, viewer.workspaceId, rows[0] as DocRow) };
  });
});

route("PUT", "/api/docs/:id", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const doc = await findDoc(db, viewer, ctx.params.id ?? "");
    memberOnly(viewer);
    const fields = textFields(ctx.body);
    const base = ctx.body.base_version;
    if (typeof base !== "number" || !Number.isInteger(base)) fields.base_version = "Send the version you edited.";
    if (Object.keys(fields).length) throw invalid(fields);
    return { status: 200, body: await saveOnto(db, viewer, doc, base as number, ctx.body.title, ctx.body.body) };
  });
});

route("GET", "/api/docs/:id/versions", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return {
    status: 200,
    body: await tx(async (db) => {
      const doc = await findDoc(db, viewer, ctx.params.id ?? "");
      memberOnly(viewer);
      const zone = await zoneOf(db, viewer.workspaceId);
      const { rows } = await db.query<{ version: number; saved_at: number; saved_by: string; title: string; body: string }>(
        "SELECT version, saved_at, saved_by, title, body FROM doc_versions WHERE doc_id = $1 ORDER BY version DESC",
        [doc.id],
      );
      return { versions: rows.map((v) => ({ ...v, saved_at: isoInstant(v.saved_at, zone) })) };
    }),
  };
});

route("POST", "/api/docs/:id/restore", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  return tx(async (db) => {
    const doc = await findDoc(db, viewer, ctx.params.id ?? "");
    memberOnly(viewer);
    const { version, base_version: base } = ctx.body;
    const fields: Record<string, string> = {};
    const { rows } = await db.query<{ title: string; body: string }>("SELECT title, body FROM doc_versions WHERE doc_id = $1 AND version = $2 AND version <> $3", [
      doc.id,
      Number.isInteger(version) ? version : 0,
      doc.version,
    ]);
    if (!rows[0]) fields.version = "Choose an older version of this doc.";
    if (typeof base !== "number" || !Number.isInteger(base)) fields.base_version = "Send the version you have open.";
    if (Object.keys(fields).length) throw invalid(fields);
    const older = rows[0] as { title: string; body: string };
    return { status: 200, body: await saveOnto(db, viewer, doc, base as number, older.title, older.body) };
  });
});
