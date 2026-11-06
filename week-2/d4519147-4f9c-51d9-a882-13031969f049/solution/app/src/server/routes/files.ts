import { randomBytes, randomUUID } from "node:crypto";
import type { Derived, PageDoc } from "../../shared/model.ts";
import { isUuid, liveRole, requireRole } from "../access.ts";
import { auditDiagram } from "../audit.ts";
import { config } from "../config.ts";
import { isUniqueViolation, many, one, oneRow, pool, tx, type Db } from "../db.ts";
import { renderJson, renderPng, renderSvg, type ExportPage } from "../exporter.ts";
import { ApiError, notFound, sendEmpty, sendJson, validation } from "../http.ts";
import { importFileName } from "../../shared/files.ts";
import { readImport } from "../importer.ts";
import { route } from "../router.ts";
import { securityHeaders } from "../security.ts";
import { sha256 } from "../hash.ts";
import type { User } from "../sessions.ts";
import { getObject, putConfirmed } from "../storage.ts";
import { assertPageRoom, createPage } from "./diagrams.ts";

/* Imports */

interface ImportRow {
  id: string;
  page_id: string;
  file_name: string;
  size_bytes: number;
  sha256: string;
  created_at: Date;
}

const importJson = (r: ImportRow) => ({ id: r.id, pageId: r.page_id, fileName: r.file_name, sizeBytes: r.size_bytes, sha256: r.sha256, createdAt: r.created_at.toISOString() });

/** Import outcomes recorded as `import.rejected`. */
const REJECTIONS = new Set(["unsupported_file_type", "invalid_model", "unsafe_file", "storage_unavailable"]);

route("POST", "/api/diagrams/{id}/imports", { auth: "session", input: "multipart" }, async (ctx) => {
  const { user } = ctx.session;
  const diagramId = ctx.params.id;
  await requireRole(pool, diagramId, user, "editor");
  const upload = ctx.file;
  if (!upload) throw validation({ file: "missing" });
  const fileName = importFileName(upload.fileName);
  const importId = randomUUID();
  const pageId = randomUUID();
  let doc: PageDoc;
  try {
    doc = readImport(upload.bytes, fileName, pageId);
    await assertPageRoom(pool, diagramId);
    const original = await putConfirmed(`imports/${diagramId}/${importId}/original`, upload.bytes, "application/octet-stream");
    await putConfirmed(`imports/${diagramId}/${importId}/model.json`, Buffer.from(JSON.stringify(doc)), "application/json");
    const created = await tx(async (db) => {
      await requireRole(db, diagramId, user, "editor", true);
      await assertPageRoom(db, diagramId);
      await createPage(db, diagramId, doc);
      const row = await oneRow<ImportRow>(
        db,
        "INSERT INTO imports (id, diagram_id, page_id, file_name, size_bytes, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id, page_id, file_name, size_bytes, sha256, created_at",
        [importId, diagramId, pageId, fileName, original.sizeBytes, original.sha256],
      );
      await auditDiagram(db, diagramId, user.email, "import.created", { importId, fileName, sha256: original.sha256 });
      return row;
    });
    sendJson(ctx.res, 201, { import: importJson(created) });
  } catch (error) {
    if (error instanceof ApiError && REJECTIONS.has(error.code)) {
      // The rejection is the import's outcome: it commits its audit event in its own transaction, with the role re-checked.
      await tx(async (db) => {
        await requireRole(db, diagramId, user, "editor");
        await auditDiagram(db, diagramId, user.email, "import.rejected", { fileName, error: error.code });
      });
    }
    throw error;
  }
});

route("GET", "/api/diagrams/{id}/imports", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  const rows = await many<ImportRow>(pool, "SELECT id, page_id, file_name, size_bytes, sha256, created_at FROM imports WHERE diagram_id = $1 ORDER BY created_at DESC, id", [params.id]);
  sendJson(res, 200, { imports: rows.map(importJson) });
});

/* Download links */

async function issueLink(db: Db, user: User, diagramId: string, objectKey: string, fileName: string, contentType: string, digest: string | null): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO download_links (token_hash, user_id, diagram_id, object_key, file_name, content_type, sha256, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())",
    [sha256(token), user.id, diagramId, objectKey, fileName, contentType, digest],
  );
  return `/api/downloads/${token}`;
}

route("GET", "/api/diagrams/{id}/imports/{importId}/original", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  if (!isUuid(params.importId)) throw notFound();
  const row = await one<ImportRow>(pool, "SELECT id, page_id, file_name, size_bytes, sha256, created_at FROM imports WHERE id = $1 AND diagram_id = $2", [params.importId, params.id]);
  if (!row) throw notFound();
  const location = await issueLink(pool, session.user, params.id, `imports/${params.id}/${row.id}/original`, row.file_name, "application/octet-stream", row.sha256);
  sendEmpty(res, 303, { Location: location });
});

/** `filename` with non-printable-ASCII, `"` and `\` replaced; `filename*` as RFC 5987 UTF-8. */
function contentDisposition(name: string): string {
  const ascii = Array.from(name).map((c) => (c >= " " && c <= "~" && c !== '"' && c !== "\\" ? c : "_")).join("");
  const encoded = Array.from(Buffer.from(name, "utf8"))
    .map((b) => {
      const c = String.fromCharCode(b);
      return b < 128 && /[A-Za-z0-9!#$&+\-.^_`|~]/.test(c) ? c : `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

interface LinkRow {
  user_id: string;
  diagram_id: string;
  object_key: string;
  file_name: string;
  content_type: string;
  sha256: string | null;
  created_at: Date;
}

/** A link streams only for its own person, while they hold a role on a live diagram, within the link's lifetime. */
route("GET", "/api/downloads/{token}", { auth: "session" }, async ({ res, session, params }) => {
  const link = await one<LinkRow>(pool, "SELECT user_id, diagram_id, object_key, file_name, content_type, sha256, created_at FROM download_links WHERE token_hash = $1", [sha256(params.token)]);
  if (!link || link.user_id !== session.user.id || !(await liveRole(pool, link.diagram_id, session.user.id))) throw notFound();
  if (Date.now() - link.created_at.getTime() >= config.timers.downloadLink * 1000) throw new ApiError(410, "link_expired", "This download link has expired. Open the file again from the Files dialog.");
  const bytes = await getObject(link.object_key);
  res.writeHead(200, {
    ...securityHeaders(res.req.url ?? "/"),
    "Content-Type": link.content_type,
    "Content-Length": String(bytes.length),
    "Content-Disposition": contentDisposition(link.file_name),
    ...(link.sha256 ? { "X-Content-SHA256": link.sha256 } : {}),
  });
  res.end(bytes);
});

/* Exports */

interface ExportFile {
  format: "png" | "svg" | "json";
  sizeBytes: number;
  sha256: string;
}

interface ExportRow {
  id: string;
  status: "pending" | "ready" | "failed";
  created_at: Date;
  created_by: string;
  page_ids: string[];
  files: ExportFile[];
}

const exportJson = (r: ExportRow) => ({ id: r.id, status: r.status, createdAt: r.created_at.toISOString(), createdBy: r.created_by, pageIds: r.page_ids, files: r.files });
const FORMATS = { png: "image/png", svg: "image/svg+xml", json: "application/json" } as const;

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-");

route("GET", "/api/diagrams/{id}/exports", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  const rows = await many<ExportRow>(pool, "SELECT id, status, created_at, created_by, page_ids, files FROM exports WHERE diagram_id = $1 ORDER BY created_at DESC, id", [params.id]);
  sendJson(res, 200, { exports: rows.map(exportJson) });
});

route("GET", "/api/diagrams/{id}/exports/{exportId}/files/{format}", { auth: "session" }, async ({ res, session, params }) => {
  await requireRole(pool, params.id, session.user, "viewer");
  if (!isUuid(params.exportId)) throw notFound();
  const row = await one<ExportRow>(pool, "SELECT id, status, created_at, created_by, page_ids, files FROM exports WHERE id = $1 AND diagram_id = $2", [params.exportId, params.id]);
  const format = params.format as keyof typeof FORMATS;
  if (!row || !Object.hasOwn(FORMATS, format)) throw notFound();
  if (row.status !== "ready") throw new ApiError(409, "export_not_ready", "This export is not ready.");
  const { title } = await oneRow<{ title: string }>(pool, "SELECT title FROM diagrams WHERE id = $1", [params.id]);
  const name = `${slug(title)}-${row.created_at.toISOString().slice(0, 10)}.${format}`;
  const location = await issueLink(pool, session.user, params.id, `exports/${params.id}/${row.id}/diagram.${format}`, name, FORMATS[format], null);
  sendEmpty(res, 303, { Location: location });
});

const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,64}$/;
const RUNNING_LEASE_MS = 5 * 60_000;

/** Claims an Idempotency-Key for one person and diagram; returns the stored 201 body on a replay. */
async function claimKey(user: User, diagramId: string, key: string): Promise<{ replay: unknown } | null> {
  for (;;) {
    try {
      await pool.query("INSERT INTO idempotency_keys (user_id, diagram_id, key, state, created_at) VALUES ($1, $2, $3, 'running', now())", [user.id, diagramId, key]);
      return null;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const row = await one<{ state: string; response: unknown; created_at: Date }>(pool, "SELECT state, response, created_at FROM idempotency_keys WHERE user_id = $1 AND diagram_id = $2 AND key = $3", [user.id, diagramId, key]);
    if (!row) continue;
    const age = Date.now() - row.created_at.getTime();
    // A key is kept for its lifetime; a first attempt that never finished (its instance stopped) frees it after a few minutes.
    if (age > config.timers.idempotencyKey * 1000 || (row.state === "running" && age > RUNNING_LEASE_MS)) {
      await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND diagram_id = $2 AND key = $3 AND created_at = $4", [user.id, diagramId, key, row.created_at]);
      continue;
    }
    if (row.state === "running") throw new ApiError(409, "idempotency_in_progress", "An export with this Idempotency-Key is still being created.");
    return { replay: row.response };
  }
}

/** An export is ready only after storage confirms all three objects; any failure marks it failed. */
async function createExport(user: User, diagramId: string, pageIds: string[]): Promise<ExportRow> {
  const id = randomUUID();
  const createdAt = new Date();
  await pool.query("INSERT INTO exports (id, diagram_id, created_by, status, page_ids, created_at) VALUES ($1, $2, $3, 'pending', $4, $5)", [id, diagramId, user.email, JSON.stringify(pageIds), createdAt]);
  try {
    const diagram = await oneRow<{ id: string; title: string }>(pool, "SELECT id, title FROM diagrams WHERE id = $1", [diagramId]);
    const rows = await many<{ id: string; doc: PageDoc; derived: Derived }>(pool, "SELECT id, doc, derived FROM pages WHERE diagram_id = $1 AND id = ANY($2::uuid[])", [diagramId, pageIds]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const pages: ExportPage[] = pageIds.map((pid) => {
      const page = byId.get(pid);
      // A page deleted while the export was being rendered fails the export.
      if (!page) throw new Error("an exported page disappeared");
      return { doc: page.doc, derived: page.derived };
    });
    const bodies: [ExportFile["format"], Buffer][] = [
      ["png", renderPng(pages)],
      ["svg", Buffer.from(renderSvg(pages))],
      ["json", Buffer.from(renderJson(diagram, pages, createdAt.toISOString()))],
    ];
    const files: ExportFile[] = [];
    for (const [format, body] of bodies) files.push({ format, ...(await putConfirmed(`exports/${diagramId}/${id}/diagram.${format}`, body, FORMATS[format])) });
    return await tx(async (db) => {
      const row = await oneRow<ExportRow>(db, "UPDATE exports SET status = 'ready', files = $1 WHERE id = $2 RETURNING id, status, created_at, created_by, page_ids, files", [JSON.stringify(files), id]);
      await auditDiagram(db, diagramId, user.email, "export.created", { exportId: id });
      return row;
    });
  } catch (error) {
    await tx(async (db) => {
      await db.query("UPDATE exports SET status = 'failed', files = '[]' WHERE id = $1", [id]);
      await auditDiagram(db, diagramId, user.email, "export.failed", { exportId: id });
    });
    throw error;
  }
}

route("POST", "/api/diagrams/{id}/exports", { auth: "session" }, async (ctx) => {
  const { user } = ctx.session;
  const diagramId = ctx.params.id;
  await requireRole(pool, diagramId, user, "viewer");
  const body = ctx.body();
  const requested = body.pageIds;
  const allPages = (await many<{ id: string }>(pool, "SELECT id FROM pages WHERE diagram_id = $1 ORDER BY seq", [diagramId])).map((r) => r.id);
  if (Array.isArray(requested) && requested.some((p) => typeof p === "string" && !allPages.includes(p))) throw notFound();
  await requireRole(pool, diagramId, user, "editor");
  const header = ctx.req.headers["idempotency-key"];
  const key = typeof header === "string" ? header : null;
  if (key !== null && !IDEMPOTENCY_KEY.test(key)) throw validation({ "Idempotency-Key": "invalid" });
  if (key !== null) {
    const claimed = await claimKey(user, diagramId, key);
    if (claimed) return sendJson(ctx.res, 201, claimed.replay, { "Idempotent-Replayed": "true" });
  }
  try {
    if (requested !== undefined && (!Array.isArray(requested) || requested.length === 0 || requested.some((p) => typeof p !== "string") || new Set(requested).size !== requested.length)) {
      throw validation({ pageIds: "invalid" });
    }
    const pageIds = (requested as string[] | undefined) ?? allPages;
    const created = { export: exportJson(await createExport(user, diagramId, pageIds)) };
    if (key !== null) await pool.query("UPDATE idempotency_keys SET state = 'done', response = $4 WHERE user_id = $1 AND diagram_id = $2 AND key = $3", [user.id, diagramId, key, JSON.stringify(created)]);
    sendJson(ctx.res, 201, created);
  } catch (error) {
    if (key !== null) await pool.query("DELETE FROM idempotency_keys WHERE user_id = $1 AND diagram_id = $2 AND key = $3 AND state = 'running'", [user.id, diagramId, key]);
    throw error;
  }
});
