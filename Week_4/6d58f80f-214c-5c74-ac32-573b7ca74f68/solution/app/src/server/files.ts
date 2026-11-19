// Files: listing, search, Recent, details, rename, locks, content links (brief: API; Business rules).
import { Readable } from "node:stream";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { first, pool, rows, tx } from "./db.js";
import { now } from "./clock.js";
import {
  bodyObject, conflict, forbidden, invalid, notFound, route, sendJson, storageUnavailable, Fail, type Ctx,
} from "./http.js";
import { isId } from "./ids.js";
import { checkName } from "./names.js";
import { present, record, type LedgerRow } from "./ledger.js";
import { publish } from "./changes.js";
import { Viewer, isPreviewable, type FileRow } from "./access.js";
import { getObject, headObject, objectKey, StorageRefused, StorageUnavailable } from "./storage.js";
import { collator } from "../shared/rules.js";
import { SORT_KEYS, type DriveFile, type LedgerEntry, type SortKey } from "../shared/api.js";

const RECENT_MAX = 50;
const LINK_TTL_MS = 60_000;
/** Signs content links; generated at each start and never stored or sent anywhere. */
const LINK_KEY = randomBytes(32);

const ORDER: Record<SortKey, (a: DriveFile, b: DriveFile) => number> = {
  "name-asc": (a, b) => collator.compare(a.name, b.name),
  "name-desc": (a, b) => collator.compare(b.name, a.name),
  "modified-desc": (a, b) => b.modifiedAt.localeCompare(a.modifiedAt),
  "modified-asc": (a, b) => a.modifiedAt.localeCompare(b.modifiedAt),
  "size-desc": (a, b) => b.size - a.size,
  "size-asc": (a, b) => a.size - b.size,
};

function sorted(files: DriveFile[], sort: SortKey): DriveFile[] {
  return files.sort((a, b) => ORDER[sort](a, b) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

/** Step 4: a live file this viewer can see, or 404. */
async function visibleFile(viewer: Viewer, id: string | undefined): Promise<FileRow> {
  const row = isId(id) ? await first<FileRow>(pool, "SELECT * FROM files WHERE id = $1", [id]) : undefined;
  if (!row || viewer.fileRole(row) === null) throw notFound();
  return row;
}

function checkQuery(value: string | null, field: string, fields: Record<string, string>): void {
  if (value !== null && (value.length < 1 || value.length > 100)) fields[field] = "Enter 1 to 100 characters.";
}

interface LinkClaims {
  fileId: string;
  purpose: "preview" | "download";
  session: string;
  issued: number;
}

function isClaims(value: unknown): value is LinkClaims {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return typeof c.fileId === "string" && (c.purpose === "preview" || c.purpose === "download")
    && typeof c.session === "string" && typeof c.issued === "number";
}

function sign(payload: string): string {
  return createHmac("sha256", LINK_KEY).update(payload).digest("base64url");
}

function linkToken(claims: LinkClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readToken(token: string): LinkClaims | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  return isClaims(claims) ? claims : null;
}

function disposition(purpose: LinkClaims["purpose"], name: string): string {
  if (purpose === "preview") return "inline";
  const plain = name.replace(/[^\x20-\x7e]/g, "_").replace(/(["\\])/g, "\\$1");
  const exotic = /[^\x20-\x7e]/.test(name);
  return `attachment; filename="${plain}"${exotic ? `; filename*=UTF-8''${encodeURIComponent(name)}` : ""}`;
}

async function setLock({ res, session, params }: Ctx, locked: boolean): Promise<void> {
  const viewer = await Viewer.load(pool, session.person);
  const row = await visibleFile(viewer, params.id);
  if (!viewer.isController) throw forbidden();
  const file = await tx(async (client) => {
    const changed = await client.query<FileRow>("UPDATE files SET locked = $2 WHERE id = $1 AND locked <> $2 AND binned_date IS NULL RETURNING *", [row.id, locked]);
    const updated = changed.rows[0];
    if (!updated) throw conflict(locked ? "already_locked" : "not_locked");
    await record(client, { actor: session.person, action: locked ? "locked" : "unlocked", fileId: row.id, folderId: row.folder_id, detail: { name: row.name } });
    await publish(client, { kind: "files", fileIds: [row.id], folderIds: [row.folder_id], storage: false });
    return updated;
  });
  sendJson(res, 200, { file: viewer.file(file) });
}

export function register(): void {
  route("GET", "/api/files", async ({ res, url, session }) => {
    const viewer = await Viewer.load(pool, session.person);
    const folderId = url.searchParams.get("folderId");
    const q = url.searchParams.get("q");
    const sortParam = url.searchParams.get("sort");
    if (folderId !== null && (!isId(folderId) || !viewer.canSeeFolder(folderId))) throw notFound();
    const fields: Record<string, string> = {};
    if (sortParam !== null && !SORT_KEYS.includes(sortParam as SortKey)) fields.sort = "Choose one of the six sort orders.";
    checkQuery(q, "q", fields);
    if (Object.keys(fields).length) throw invalid(fields);
    const sort = (SORT_KEYS.find((k) => k === sortParam) ?? "name-asc");
    if (q !== null) {
      const found = await rows<FileRow>(pool, "SELECT * FROM files WHERE binned_date IS NULL AND strpos(lower(name), lower($1)) > 0", [q]);
      const files = found.filter((f) => viewer.fileRole(f) !== null).map((f) => viewer.file(f));
      sendJson(res, 200, { folders: [], files: sorted(files, sort) });
      return;
    }
    if (folderId !== null) {
      const folders = viewer.visibleFolders().filter((f) => f.parent_id === folderId)
        .sort((a, b) => collator.compare(a.name, b.name)).map((f) => viewer.folder(f));
      const inside = await rows<FileRow>(pool, "SELECT * FROM files WHERE folder_id = $1 AND binned_date IS NULL", [folderId]);
      sendJson(res, 200, { folders, files: sorted(inside.map((f) => viewer.file(f)), sort) });
      return;
    }
    const top = viewer.visibleFolders().filter((f) => !f.parent_id || !viewer.canSeeFolder(f.parent_id))
      .sort((a, b) => collator.compare(a.name, b.name)).map((f) => viewer.folder(f));
    sendJson(res, 200, { folders: top, files: [] });
  });

  route("GET", "/api/files/recent", async ({ res, session }) => {
    const viewer = await Viewer.load(pool, session.person);
    const recent = await rows<FileRow>(pool,
      `SELECT f.* FROM files f JOIN (SELECT file_id, max(at) AS last_at, max(id) AS last_id FROM ledger
          WHERE file_id IS NOT NULL GROUP BY file_id) l ON l.file_id = f.id
        WHERE f.binned_date IS NULL ORDER BY l.last_at DESC, l.last_id DESC`);
    const files = recent.filter((f) => viewer.fileRole(f) !== null).slice(0, RECENT_MAX).map((f) => viewer.file(f));
    sendJson(res, 200, { files });
  });

  route("GET", "/api/files/:id", async ({ res, session, params }) => {
    const viewer = await Viewer.load(pool, session.person);
    const row = await visibleFile(viewer, params.id);
    sendJson(res, 200, { file: viewer.file(row), path: viewer.path(row.folder_id) });
  });

  route("PATCH", "/api/files/:id", async (ctx) => {
    const { res, session, params } = ctx;
    const viewer = await Viewer.load(pool, session.person);
    const row = await visibleFile(viewer, params.id);
    if (viewer.fileRole(row) !== "editor") throw forbidden();
    if (row.locked) throw conflict("locked");
    const body = bodyObject(ctx);
    const checked = checkName(body.name);
    if ("error" in checked) throw invalid({ name: checked.error });
    const file = await tx(async (client) => {
      const changed = await client.query<FileRow>(
        "UPDATE files SET name = $2 WHERE id = $1 AND NOT locked AND binned_date IS NULL RETURNING *", [row.id, checked.name]);
      const updated = changed.rows[0];
      if (!updated) throw conflict("locked");
      await record(client, { actor: session.person, action: "renamed", fileId: row.id, folderId: row.folder_id, detail: { oldName: row.name, newName: checked.name } });
      await publish(client, { kind: "files", fileIds: [row.id], folderIds: [row.folder_id], storage: false });
      return updated;
    });
    sendJson(res, 200, { file: viewer.file(file) });
  });

  route("GET", "/api/files/:id/activity", async ({ res, session, params }) => {
    const viewer = await Viewer.load(pool, session.person);
    const row = await visibleFile(viewer, params.id);
    const entries = await rows<LedgerRow>(pool, "SELECT * FROM ledger WHERE file_id = $1 ORDER BY at DESC, id DESC", [row.id]);
    sendJson(res, 200, { entries: entries.map((e) => present(viewer, e)).filter((e): e is LedgerEntry => e !== null) });
  });

  route("POST", "/api/files/:id/lock", (ctx) => setLock(ctx, true));
  route("DELETE", "/api/files/:id/lock", (ctx) => setLock(ctx, false));

  route("POST", "/api/files/:id/links", async (ctx) => {
    const { res, session, params } = ctx;
    const viewer = await Viewer.load(pool, session.person);
    const row = await visibleFile(viewer, params.id);
    const body = bodyObject(ctx);
    const purpose = body.purpose === "preview" || body.purpose === "download" ? body.purpose : null;
    if (!purpose) throw invalid({ purpose: "Choose preview or download." });
    if (purpose === "preview" && !isPreviewable(row.content_type)) throw invalid({ purpose: "No preview for this file type." });
    try {
      if (await headObject(objectKey(row.id)) === null) throw notFound();
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      throw error;
    }
    const issued = now().getTime();
    const token = linkToken({ fileId: row.id, purpose, session: session.tokenHash, issued });
    sendJson(res, 201, { url: `/api/content/${token}`, expiresAt: new Date(issued + LINK_TTL_MS).toISOString() });
  });

  route("GET", "/api/content/:token", async ({ res, session, params }) => {
    const claims = readToken(params.token ?? "");
    if (!claims || claims.session !== session.tokenHash) throw notFound();
    const viewer = await Viewer.load(pool, session.person);
    const row = await visibleFile(viewer, claims.fileId);
    if (now().getTime() - claims.issued >= LINK_TTL_MS) throw new Fail(410, { error: "link_expired" });
    let object: Response;
    try {
      object = await getObject(objectKey(row.id));
    } catch (error) {
      if (error instanceof StorageUnavailable) throw storageUnavailable();
      if (error instanceof StorageRefused && error.status === 404) throw notFound();
      throw error;
    }
    res.writeHead(200, {
      "content-type": row.content_type,
      "content-length": object.headers.get("content-length") ?? String(row.size),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": disposition(claims.purpose, row.name),
      ...(claims.purpose === "preview" ? { "content-security-policy": "sandbox" } : {}),
    });
    if (!object.body) {
      res.end();
      return;
    }
    Readable.fromWeb(object.body as import("node:stream/web").ReadableStream<Uint8Array>).on("error", () => res.destroy()).pipe(res);
  });
}
