// Resumable multipart uploads (brief: Business rules, Uploads). Upload transitions are decided here only. The file
// row, its ledger entry, the folder count and the storage total appear in one transaction, after storage has
// confirmed the finished object.
import type pg from "pg";
import { first, isUniqueViolation, pool, rows, tx } from "./db.js";
import { now } from "./clock.js";
import { config } from "./config.js";
import {
  bodyObject, conflict, forbidden, invalid, notFound, route, sendEmpty, sendJson, storageUnavailable, type Ctx,
} from "./http.js";
import { isId, newId } from "./ids.js";
import { checkName } from "./names.js";
import { record } from "./ledger.js";
import { publish } from "./changes.js";
import { Viewer, type FileRow } from "./access.js";
import { keyOf, remember, replay } from "./idempotency.js";
import {
  abortMultipart, completeMultipart, createMultipart, headObject, objectKey, StorageRefused, StorageUnavailable, uploadPart,
} from "./storage.js";
import { PART_SIZE, type Upload, type UploadState } from "../shared/api.js";
import { MAX_FILE_BYTES, partBytes, partCount } from "../shared/rules.js";

const SCOPE = "uploads";

/** `dismissed` is an abandoned upload its owner has cleared; like `cancelled` its id answers 404. */
type StoredState = UploadState | "dismissed";
/** The states an upload id still answers in. */
type OpenState = Exclude<StoredState, "cancelled" | "dismissed">;
type Step = "part" | "pause" | "resume" | "complete" | "cancel" | "expire";

interface UploadRow<S extends StoredState = StoredState> {
  id: string;
  owner_id: string;
  folder_id: string;
  name: string;
  size: number;
  content_type: string;
  state: S;
  part_count: number;
  storage_upload_id: string;
  last_activity_at: Date;
}

const LIVE: OpenState[] = ["started", "uploading", "paused"];
const LISTED: OpenState[] = [...LIVE, "abandoned"];

/**
 * The upload state machine, decided here only: the state a step leads to (the same state for an idempotent step),
 * or the step's exact 409. `missing` is the parts a complete still lacks.
 */
function transition(state: OpenState, step: "cancel"): "cancelled" | "dismissed";
function transition(state: OpenState, step: Exclude<Step, "cancel">, missing?: number[]): OpenState;
function transition(state: OpenState, step: Step, missing: number[] = []): StoredState {
  const sending = state === "started" || state === "uploading";
  switch (step) {
    case "part":
      if (sending) return "uploading";
      break;
    case "pause":
      if (LIVE.includes(state)) return "paused";
      break;
    case "resume":
      if (sending) return state;
      if (state === "paused") return "uploading";
      break;
    case "complete":
      if (state === "confirmed") return state;
      if (!sending) break;
      if (missing.length) throw conflict("parts_missing", { missing });
      return "confirmed";
    case "cancel":
      if (LIVE.includes(state)) return "cancelled";
      if (state === "abandoned") return "dismissed";
      break;
    case "expire":
      if (LIVE.includes(state)) return "abandoned";
      break;
  }
  throw conflict(`upload_${state}`);
}

function isOpen(row: UploadRow): row is UploadRow<OpenState> {
  return row.state !== "cancelled" && row.state !== "dismissed";
}

function expiresAt(row: UploadRow<OpenState>): string | null {
  if (!LIVE.includes(row.state)) return null;
  return new Date(row.last_activity_at.getTime() + config.uploadPauseTtlSeconds * 1000).toISOString();
}

/** An upload left idle for the configured period is abandoned. */
function idleTooLong(row: UploadRow<OpenState>, at: Date): boolean {
  return at.getTime() - row.last_activity_at.getTime() >= config.uploadPauseTtlSeconds * 1000;
}

async function presentUpload(db: pg.PoolClient | pg.Pool, row: UploadRow<OpenState>): Promise<Upload> {
  const parts = await rows<{ n: number }>(db, "SELECT n FROM upload_parts WHERE upload_id = $1 ORDER BY n", [row.id]);
  return {
    id: row.id, folderId: row.folder_id, name: row.name, size: row.size, contentType: row.content_type,
    state: row.state, partSize: PART_SIZE, partCount: row.part_count,
    confirmedParts: parts.map((p) => p.n), expiresAt: expiresAt(row),
  };
}

/** Step 4 for an upload: only its owner sees it, and a cancelled or dismissed upload is gone. */
async function ownUpload(db: pg.PoolClient | pg.Pool, ctx: Ctx, lock = false): Promise<UploadRow<OpenState>> {
  const id = ctx.params.id;
  const row = isId(id)
    ? await first<UploadRow>(db, `SELECT * FROM uploads WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id])
    : undefined;
  if (!row || row.owner_id !== ctx.session.person.id || !isOpen(row)) throw notFound();
  return row;
}

/** Access is checked on every request: the uploader must still be able to edit the upload's folder. */
async function stillEditor(ctx: Ctx, row: UploadRow): Promise<Viewer> {
  const viewer = await Viewer.load(pool, ctx.session.person);
  if (!viewer.canSeeFolder(row.folder_id)) throw notFound();
  if (viewer.folderRole(row.folder_id) !== "editor") throw forbidden();
  return viewer;
}

/** Records the state a step led to; an idempotent step leaves the row as it was. */
async function enter<S extends StoredState>(client: pg.PoolClient, row: UploadRow<OpenState>, next: S): Promise<UploadRow<S | OpenState>> {
  if (next === row.state) return row;
  const at = now();
  await client.query(
    "UPDATE uploads SET state = $2, last_activity_at = $3, cleanup_pending = cleanup_pending OR $4 WHERE id = $1",
    [row.id, next, at, next === "cancelled"]);
  return { ...row, state: next, last_activity_at: at };
}

function storageCall<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error: unknown) => {
    if (error instanceof StorageUnavailable) throw storageUnavailable();
    throw error;
  });
}

async function removeParts(row: UploadRow): Promise<void> {
  try {
    await abortMultipart(objectKey(row.id), row.storage_upload_id);
    await pool.query("UPDATE uploads SET cleanup_pending = false WHERE id = $1", [row.id]);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
}

/** Sweep step: idle uploads become abandoned and lose their parts; cleanups that met a storage outage retry. */
export async function expireUploads(): Promise<void> {
  const at = now();
  const live = await rows<UploadRow<OpenState>>(pool, "SELECT * FROM uploads WHERE state = ANY($1)", [LIVE]);
  for (const row of live.filter((r) => idleTooLong(r, at))) {
    const next = transition(row.state, "expire");
    await tx(async (client) => {
      const claimed = await client.query(
        "UPDATE uploads SET state = $4, cleanup_pending = true WHERE id = $1 AND state = ANY($2) AND last_activity_at = $3",
        [row.id, LIVE, row.last_activity_at, next]);
      if (!claimed.rowCount) return;
      await publish(client, { kind: "upload", ownerId: row.owner_id, upload: await presentUpload(client, { ...row, state: next }), expired: true });
    });
  }
  for (const row of await rows<UploadRow>(pool, "SELECT * FROM uploads WHERE cleanup_pending")) await removeParts(row);
}

export function register(): void {
  route("POST", "/api/uploads", async (ctx) => {
    const { req, res, session } = ctx;
    const body = bodyObject(ctx);
    const viewer = await Viewer.load(pool, session.person);
    const folder = isId(body.folderId) ? viewer.folders.get(body.folderId) : undefined;
    if (!folder || !viewer.canSeeFolder(folder.id)) throw notFound();
    if (viewer.folderRole(folder.id) !== "editor") throw forbidden();
    const key = keyOf(req.headers["idempotency-key"]);
    const stored = await replay(pool, session.person.id, SCOPE, key, body);
    if (stored) {
      sendJson(res, stored.status, stored.body, { "idempotent-replayed": "true" });
      return;
    }
    const fields: Record<string, string> = {};
    const name = checkName(body.name);
    if ("error" in name) fields.name = name.error;
    const size = body.size;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
      fields.size = "Files can be up to 2,000,000,000 bytes.";
    }
    const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
    if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(contentType) || contentType.length > 127) {
      fields.contentType = "Choose a file with a known type.";
    }
    if (Object.keys(fields).length || "error" in name || typeof size !== "number") throw invalid(fields);
    const id = newId();
    const storageUploadId = await storageCall(() => createMultipart(objectKey(id), contentType));
    const row: UploadRow<OpenState> = {
      id, owner_id: session.person.id, folder_id: folder.id, name: name.name, size, content_type: contentType,
      state: "started", part_count: partCount(size), storage_upload_id: storageUploadId, last_activity_at: now(),
    };
    try {
      const upload = await tx(async (client) => {
        await client.query(
          `INSERT INTO uploads (id, owner_id, folder_id, name, size, content_type, state, part_count, storage_upload_id, last_activity_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [row.id, row.owner_id, row.folder_id, row.name, row.size, row.content_type, row.state, row.part_count, row.storage_upload_id, row.last_activity_at]);
        const shown = await presentUpload(client, row);
        await remember(client, session.person.id, SCOPE, key, body, { status: 201, body: { upload: shown } });
        return shown;
      });
      sendJson(res, 201, { upload });
    } catch (error) {
      await abortMultipart(objectKey(id), storageUploadId).catch(() => undefined);
      const raced = isUniqueViolation(error) ? await replay(pool, session.person.id, SCOPE, key, body) : null;
      if (!raced) throw error;
      sendJson(res, raced.status, raced.body, { "idempotent-replayed": "true" });
    }
  });

  route("GET", "/api/uploads", async ({ res, session }) => {
    const list = await rows<UploadRow<OpenState>>(pool, "SELECT * FROM uploads WHERE owner_id = $1 AND state = ANY($2) ORDER BY created_at", [session.person.id, LISTED]);
    sendJson(res, 200, { uploads: await Promise.all(list.map((u) => presentUpload(pool, u))) });
  });

  route("GET", "/api/uploads/:id", async (ctx) => {
    sendJson(ctx.res, 200, { upload: await presentUpload(pool, await ownUpload(pool, ctx)) });
  });

  route("PUT", "/api/uploads/:id/parts/:n", async (ctx) => {
    const row = await ownUpload(pool, ctx);
    await stillEditor(ctx, row);
    transition(row.state, "part");
    const n = /^\d{1,6}$/.test(ctx.params.n ?? "") ? Number(ctx.params.n) : 0;
    const data = ctx.raw ?? Buffer.alloc(0);
    if (n < 1 || n > row.part_count || data.length !== partBytes(n, row.size)) {
      throw invalid({ part: `Send part 1 to ${row.part_count}; every part but the last is exactly ${PART_SIZE} bytes.` });
    }
    // A cancel or expiry that removed the storage session while this part was on its way leaves nothing to add to.
    const etag = await storageCall(() => uploadPart(objectKey(row.id), row.storage_upload_id, n, data)).catch(async (error: unknown) => {
      if (error instanceof StorageRefused && error.code === "NoSuchUpload") transition((await ownUpload(pool, ctx)).state, "part");
      throw error;
    });
    const upload = await tx(async (client) => {
      const current = await ownUpload(client, ctx, true);
      const next = transition(current.state, "part");
      await client.query(
        `INSERT INTO upload_parts (upload_id, n, etag, size) VALUES ($1, $2, $3, $4)
         ON CONFLICT (upload_id, n) DO UPDATE SET etag = EXCLUDED.etag, size = EXCLUDED.size`, [row.id, n, etag, data.length]);
      return presentUpload(client, await enter(client, current, next));
    });
    sendJson(ctx.res, 200, { upload });
  }, { binary: true });

  route("POST", "/api/uploads/:id/pause", async (ctx) => {
    const upload = await tx(async (client) => {
      const row = await ownUpload(client, ctx, true);
      return presentUpload(client, await enter(client, row, transition(row.state, "pause")));
    });
    sendJson(ctx.res, 200, { upload });
  });

  route("POST", "/api/uploads/:id/resume", async (ctx) => {
    const upload = await tx(async (client) => {
      const row = await ownUpload(client, ctx, true);
      return presentUpload(client, await enter(client, row, transition(row.state, "resume")));
    });
    sendJson(ctx.res, 200, { upload });
  });

  route("POST", "/api/uploads/:id/complete", async (ctx) => {
    const { res, session } = ctx;
    const row = await ownUpload(pool, ctx);
    const viewer = await stillEditor(ctx, row);
    const parts = await rows<{ n: number; etag: string }>(pool, "SELECT n, etag FROM upload_parts WHERE upload_id = $1 ORDER BY n", [row.id]);
    const missing = Array.from({ length: row.part_count }, (_, i) => i + 1).filter((n) => !parts.some((p) => p.n === n));
    if (transition(row.state, "complete", missing) === row.state) {
      const file = await first<FileRow>(pool, "SELECT * FROM files WHERE id = $1", [row.id]);
      if (!file) throw notFound();
      sendJson(res, 200, { file: viewer.file(file) });
      return;
    }
    const key = objectKey(row.id);
    const storedSize = await storageCall(async () => {
      try {
        await completeMultipart(key, row.storage_upload_id, parts);
      } catch (error) {
        if (!(error instanceof StorageRefused && error.code === "NoSuchUpload")) throw error;
      }
      return headObject(key);
    });
    if (storedSize === null) throw storageUnavailable();
    const outcome = await tx(async (client) => {
      const current = await ownUpload(client, ctx, true);
      const next = transition(current.state, "complete");
      if (next === current.state) return { status: 200, file: await first<FileRow>(client, "SELECT * FROM files WHERE id = $1", [row.id]) };
      const created = await client.query<FileRow>(
        `INSERT INTO files (id, name, folder_id, size, content_type, modified_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [row.id, row.name, row.folder_id, storedSize, row.content_type, now()]);
      await enter(client, current, next);
      await client.query("DELETE FROM upload_parts WHERE upload_id = $1", [row.id]);
      await record(client, { actor: session.person, action: "uploaded", fileId: row.id, folderId: row.folder_id, detail: { name: row.name, folder: viewer.shownFolder(row.folder_id) } });
      await publish(client, { kind: "files", fileIds: [row.id], folderIds: [row.folder_id], storage: true });
      return { status: 201, file: created.rows[0] };
    });
    if (!outcome.file) throw notFound();
    sendJson(res, outcome.status, { file: viewer.file(outcome.file) });
  });

  route("DELETE", "/api/uploads/:id", async (ctx) => {
    const cancelled = await tx(async (client) => {
      const row = await ownUpload(client, ctx, true);
      const next = transition(row.state, "cancel");
      await enter(client, row, next);
      return next === "cancelled" ? row : null;
    });
    sendEmpty(ctx.res);
    // The reply never waits on storage: the row is already cleanup_pending, and the sweep retries what this misses.
    if (cancelled) void removeParts(cancelled).catch(() => undefined);
  });
}
