// Attachments: stored in MinIO first, listed only once their row exists, downloaded only by
// people who can see the parent record.
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage } from "node:http";
import { canSeeProject, isChannelMember, type Viewer } from "./access.js";
import { one, query, tx, type Db } from "./db.js";
import { ApiError, invalid } from "./errors.js";
import type { Ctx } from "./http.js";
import { emitIssue } from "./issues.js";
import { route } from "./router.js";
import { UPLOAD_LIMIT } from "./http.js";
import { deleteObject, getObject, putObject } from "./s3.js";
import { FILE_LIMIT, FILENAME_LIMIT, textWithin } from "../shared/text.js";
import { nowMs } from "./time.js";

type ParentType = "issue" | "message" | "doc";

const PARENT_COLUMN: Record<ParentType, string> = { issue: "issue_id", message: "message_id", doc: "doc_id" };

interface AttachmentRow {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  object_key: string;
  parent_id: string;
  parent_ref: string | number;
}

function attachmentJson(row: AttachmentRow, type: ParentType): Record<string, unknown> {
  return { id: row.id, filename: row.filename, size: row.size, content_type: row.content_type, parent: { type, id: row.parent_ref } };
}

const PARENT_REF: Record<ParentType, string> = {
  issue: "(SELECT key FROM issues WHERE id = a.issue_id)",
  message: "a.message_id",
  doc: "a.doc_id",
};

/** Attachments grouped by parent id, oldest first. */
export async function attachmentsOf(db: Db, type: ParentType, parentIds: (string | number)[]): Promise<Map<string | number, Record<string, unknown>[]>> {
  const column = PARENT_COLUMN[type];
  const { rows } = await db.query<AttachmentRow>(
    `SELECT a.id, a.filename, a.size, a.content_type, a.object_key, a.${column} AS parent_id, ${PARENT_REF[type]} AS parent_ref
     FROM attachments a WHERE a.${column} = ANY($1) ORDER BY a.created_at, a.id`,
    [parentIds],
  );
  const grouped = new Map<string | number, Record<string, unknown>[]>();
  for (const row of rows) {
    const list = grouped.get(row.parent_id) ?? [];
    list.push(attachmentJson(row, type));
    grouped.set(row.parent_id, list);
  }
  return grouped;
}

/** Queues the stored objects of these messages for deletion, in the deleting transaction. */
export async function queueObjectDeletions(db: Db, messageIds: number[]): Promise<void> {
  await db.query("INSERT INTO attachment_deletions (object_key) SELECT object_key FROM attachments WHERE message_id = ANY($1)", [messageIds]);
}

/** Works through the deletion queue; storage being down leaves the rest for the next round. */
export async function drainObjectDeletions(): Promise<void> {
  for (const row of await query<{ id: number; object_key: string }>("SELECT id, object_key FROM attachment_deletions ORDER BY id")) {
    await deleteObject(row.object_key);
    await query("DELETE FROM attachment_deletions WHERE id = $1", [row.id]);
  }
}

/** The parent's id if the viewer can see it, else not_found; messages also enforce authorship. */
async function resolveParent(db: Db, viewer: Viewer, type: ParentType, ref: string, forUpload: boolean): Promise<string | number> {
  if (type === "issue") {
    const row = await db.query<{ id: string; project_id: string }>("SELECT id, project_id FROM issues WHERE workspace_id = $1 AND key = $2", [viewer.workspaceId, ref]);
    const issue = row.rows[0];
    if (!issue || !(await canSeeProject(db, viewer, issue.project_id))) throw new ApiError("not_found");
    return issue.id;
  }
  if (type === "doc") {
    const row = await db.query<{ id: string; project_id: string }>("SELECT id, project_id FROM docs WHERE workspace_id = $1 AND id::text = $2", [viewer.workspaceId, ref]);
    const doc = row.rows[0];
    if (!doc || !(await canSeeProject(db, viewer, doc.project_id))) throw new ApiError("not_found");
    return doc.id;
  }
  if (!/^\d{1,15}$/.test(ref)) throw new ApiError("not_found");
  const row = await db.query<{ id: number; channel_id: string; author_id: string }>("SELECT id, channel_id, author_id FROM messages WHERE workspace_id = $1 AND id = $2", [viewer.workspaceId, Number(ref)]);
  const message = row.rows[0];
  if (!message || !(await isChannelMember(db, viewer.id, message.channel_id))) throw new ApiError("not_found");
  if (forUpload && message.author_id !== viewer.id) throw new ApiError("not_author");
  return message.id;
}

interface Upload {
  filename: string;
  contentType: string;
  data: Buffer;
}

const noFile = (): ApiError => invalid({ file: "Attach one file." });

function param(headers: string, name: string): string | undefined {
  const extended = new RegExp(`;\\s*${name}\\*=UTF-8''([^;\\r\\n]*)`, "i").exec(headers);
  if (extended?.[1] !== undefined) return decodeURIComponent(extended[1]);
  const quoted = new RegExp(`;\\s*${name}="([^"]*)"`, "i").exec(headers);
  if (quoted?.[1] !== undefined) return quoted[1].replace(/%22/g, '"').replace(/%0D/g, "\r").replace(/%0A/g, "\n");
  return new RegExp(`;\\s*${name}=([^;\\r\\n]+)`, "i").exec(headers)?.[1]?.trim();
}

/** The `file` part of a multipart/form-data body, its name as the browser sent it. */
async function readUpload(req: IncomingMessage): Promise<Upload> {
  const boundary = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(req.headers["content-type"] ?? "");
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) throw noFile();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > UPLOAD_LIMIT) throw new ApiError("too_large");
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);
  const delimiter = Buffer.from(`--${marker}`);
  let at = body.indexOf(delimiter);
  while (at !== -1 && body.subarray(at + delimiter.length, at + delimiter.length + 2).toString() !== "--") {
    const headerStart = at + delimiter.length + 2;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) break;
    const next = body.indexOf(Buffer.from(`\r\n--${marker}`), headerEnd + 4);
    if (next === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = /^content-disposition:(.*)$/im.exec(headers)?.[1] ?? "";
    const filename = param(disposition, "filename");
    if (param(disposition, "name") === "file" && filename !== undefined) {
      const data = body.subarray(headerEnd + 4, next);
      if (data.length > FILE_LIMIT) throw new ApiError("too_large");
      const contentType = /^content-type:\s*(.+)$/im.exec(headers)?.[1]?.trim() || "application/octet-stream";
      return { filename, contentType, data: Buffer.from(data) };
    }
    at = next + 2;
  }
  throw noFile();
}

function safeName(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function upload(ctx: Ctx, type: ParentType): Promise<{ status: number; body: unknown }> {
  const viewer = ctx.viewer;
  const parentId = await tx((db) => resolveParent(db, viewer, type, ctx.params.ref ?? "", true));
  const file = await readUpload(ctx.req);
  if (!textWithin(file.filename, 1, FILENAME_LIMIT)) throw invalid({ file: "That file name is too long. Use 255 characters or fewer." });
  if (file.data.length === 0) throw invalid({ file: "The file is empty." });
  const slug = (await one<{ slug: string }>("SELECT slug FROM workspaces WHERE id = $1", [viewer.workspaceId]))?.slug ?? "";
  const id = randomUUID();
  const objectKey = `${slug}/${id}/${safeName(file.filename)}`;
  await putObject(objectKey, file.data, file.contentType);
  try {
    const row = await tx(async (db) => {
      await resolveParent(db, viewer, type, ctx.params.ref ?? "", true);
      await db.query(
        `INSERT INTO attachments (id, workspace_id, ${PARENT_COLUMN[type]}, filename, size, content_type, object_key, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, viewer.workspaceId, parentId, file.filename, file.data.length, file.contentType, objectKey, nowMs()],
      );
      const { rows } = await db.query<AttachmentRow>(
        `SELECT a.id, a.filename, a.size, a.content_type, a.object_key, a.${PARENT_COLUMN[type]} AS parent_id, ${PARENT_REF[type]} AS parent_ref FROM attachments a WHERE a.id = $1`,
        [id],
      );
      if (type === "issue") await emitIssue(db, viewer.workspaceId, ctx.params.ref ?? "");
      return rows[0] as AttachmentRow;
    });
    return { status: 201, body: attachmentJson(row, type) };
  } catch (error) {
    await deleteObject(objectKey).catch(() => undefined);
    throw error;
  }
}

route("POST", "/api/issues/:ref/attachments", { access: "workspace", upload: true }, (ctx) => upload(ctx, "issue"));
route("POST", "/api/messages/:ref/attachments", { access: "workspace", upload: true }, (ctx) => upload(ctx, "message"));
route("POST", "/api/docs/:ref/attachments", { access: "workspace", upload: true }, (ctx) => upload(ctx, "doc"));

const ACTIVE_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml", "text/javascript", "application/javascript"]);

/** Types a browser would run are sent as opaque bytes. */
function servedType(stored: string): string {
  return ACTIVE_TYPES.has(stored.split(";")[0]?.trim().toLowerCase() ?? "") ? "application/octet-stream" : stored;
}

function contentDisposition(filename: string): string {
  const fallback = [...filename].map((c) => (c.codePointAt(0) as number) >= 0x20 && (c.codePointAt(0) as number) <= 0x7e && c !== '"' && c !== "\\" ? c : "_").join("");
  const encoded = [...Buffer.from(filename, "utf8")]
    .map((byte) => {
      const c = String.fromCharCode(byte);
      return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

route("GET", "/api/attachments/:id", { access: "workspace" }, async (ctx) => {
  const viewer = ctx.viewer;
  const row = await tx(async (db) => {
    const { rows } = await db.query<{ object_key: string; filename: string; size: number; content_type: string; issue_id: string | null; message_id: number | null; doc_id: string | null }>(
      "SELECT a.object_key, a.filename, a.size, a.content_type, a.issue_id, a.message_id, a.doc_id, i.key AS issue_key FROM attachments a LEFT JOIN issues i ON i.id = a.issue_id WHERE a.id::text = $1 AND a.workspace_id = $2",
      [ctx.params.id ?? "", viewer.workspaceId],
    );
    const found = rows[0] as ((typeof rows)[number] & { issue_key: string | null }) | undefined;
    if (!found) throw new ApiError("not_found");
    if (found.issue_key) await resolveParent(db, viewer, "issue", found.issue_key, false);
    else if (found.doc_id) await resolveParent(db, viewer, "doc", found.doc_id, false);
    else await resolveParent(db, viewer, "message", String(found.message_id), false);
    return found;
  });
  const res = ctx.res;
  const left = new AbortController();
  res.on("close", () => left.abort());
  const body = await getObject(row.object_key, left.signal);
  res.writeHead(200, {
    "Content-Type": servedType(row.content_type),
    "Content-Length": String(row.size),
    "Content-Disposition": contentDisposition(row.filename),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  await pipeline(body, res).catch(() => undefined);
});

