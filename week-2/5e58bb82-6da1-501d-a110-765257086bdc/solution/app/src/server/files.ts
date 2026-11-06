// Line files: stored as recorded, and recorded only after storage confirms a checksummed write.
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type pg from "pg";
import type { Db } from "./db.js";
import { one, only, pool, tx } from "./db.js";
import { refreshCoverage } from "./coverage.js";
import { recordEvent, SYSTEM } from "./history.js";
import { requireUser } from "./auth.js";
import { conflict, errorBody, FILE_LIMIT, forbidden, headerValue, invalid, isRecord, notFound, payloadTooLarge, readBody, storageUnavailable, unsupportedMedia } from "./http.js";
import { lineJson, loadLine } from "./lines.js";
import { missionFor } from "./missions.js";
import { newId } from "./passwords.js";
import type { LineRecord, LineView, UploadRecord, UserRecord } from "./records.js";
import { getObject, putObject, StorageError } from "./s3.js";
import { status } from "./status.js";

const FILE_NAME = /^(?!\.)[A-Za-z0-9._-]{1,120}$/;
const SHA = /^[0-9a-fA-F]{64}$/;
const PART_BYTES = 4_000_000;

export const objectKey = (line: Pick<LineRecord, "id" | "mission_id">, name: string) => `lines/${line.mission_id}/${line.id}/${name}`;

/** The line and its mission as this user may see them, else 404; clients may read but not write. */
async function lineFor(db: Db, user: UserRecord, lineId: string, write: boolean, lock = false): Promise<LineRecord> {
  const line = await one<LineRecord>(db, `SELECT * FROM lines WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [lineId]);
  if (!line) throw notFound();
  await missionFor(db, user, line.mission_id);
  if (write && user.role === "client_reviewer") throw forbidden();
  return line;
}

const sameFile = (line: LineRecord, sha: string, size: number) => line.file_state === "Stored" && line.file_sha256 === sha && Number(line.file_size) === size;

/** The 409s every upload path shares, in the published order. */
function refuseUpload(line: LineRecord, sha: string, size: number): void {
  if (line.status === "Delivered" && !sameFile(line, sha, size)) throw conflict("already_delivered", `${line.label} already holds a different file`);
  if (line.status !== "Surveyed" && line.status !== "Delivered") throw conflict("line_not_surveyed", `${line.label} has not been surveyed yet.`);
}

/** Records the stored file, moves the line to Delivered and supersedes the original of a re-run. */
async function recordStored(db: pg.PoolClient, line: LineRecord, name: string, size: number, sha: string): Promise<LineView> {
  const now = new Date();
  await db.query(
    "UPDATE lines SET status = 'Delivered', file_state = 'Stored', file_name = $2, file_size = $3, file_sha256 = $4, file_stored_at = $5 WHERE id = $1",
    [line.id, name, size, sha, now]);
  await recordEvent(db, line.mission_id, "file", SYSTEM, `${line.label} file stored`, now);
  await recordEvent(db, line.mission_id, "line", SYSTEM, `${line.label} Surveyed → Delivered`, now);
  if (line.rerun_of) {
    const original = await only<LineRecord>(db, "SELECT * FROM lines WHERE id = $1 FOR UPDATE", [line.rerun_of]);
    await db.query("UPDATE lines SET status = 'Superseded' WHERE id = $1", [original.id]);
    await recordEvent(db, line.mission_id, "line", SYSTEM, `${original.label} ${original.status} → Superseded`, now);
  }
  await refreshCoverage(db, line.mission_id);
  return loadLine(db, line.mission_id, line.id);
}

/** Writes and records one whole file, holding the line's row lock so simultaneous uploads take turns. */
async function storeWhole(user: UserRecord, lineId: string, data: Buffer, sha: string, name: string, fieldErrors: Record<string, string>): Promise<{ status: number; body: unknown }> {
  return tx(async (db) => {
    const line = await lineFor(db, user, lineId, true, true);
    if (line.status === "Delivered" && sameFile(line, sha, data.length)) {
      return { status: 200, body: lineJson(await loadLine(db, line.mission_id, line.id)) };
    }
    refuseUpload(line, sha, data.length);
    if (Object.keys(fieldErrors).length) throw invalid(fieldErrors);
    if (status.storage === "down") throw storageUnavailable();
    try {
      await putObject(objectKey(line, name), data, sha, "application/octet-stream");
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable();
      throw error;
    }
    return { status: 201, body: lineJson(await recordStored(db, line, name, data.length, sha)) };
  });
}

/** Step 1 of the error precedence for raw bodies: 413 from the declared length, then 415, before the session. */
function checkRawBody(req: IncomingMessage, limit: number): void {
  const declared = Number(req.headers["content-length"] ?? NaN);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw payloadTooLarge();
  }
  if ((req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/octet-stream") {
    req.resume();
    throw unsupportedMedia("application/octet-stream");
  }
}

export async function uploadWhole(req: IncomingMessage, lineId: string): Promise<{ status: number; body: unknown }> {
  checkRawBody(req, FILE_LIMIT);
  const user = await requireUser(req);
  await lineFor(pool, user, lineId, true);
  const data = await readBody(req, FILE_LIMIT);
  const name = headerValue(req, "X-Line-File-Name");
  const declaredSha = headerValue(req, "X-Content-SHA256");
  const sha = createHash("sha256").update(data).digest("hex");
  const errors: Record<string, string> = {};
  if (!data.length) errors.file = "The file is empty";
  if (!FILE_NAME.test(name)) errors.file_name = "Use a file name of 1 to 120 letters, digits, dots, underscores or hyphens";
  if (!SHA.test(declaredSha)) errors.sha256 = "Enter the 64-character SHA-256 from the logger";
  else if (declaredSha.toLowerCase() !== sha) errors.sha256 = "Checksum does not match this file. Nothing was stored.";
  return storeWhole(user, lineId, data, sha, name, errors);
}

/** Opens (or resumes) a resumable upload for files over 8,000,000 bytes. */
export async function openUpload(user: UserRecord, lineId: string, raw: unknown): Promise<{ status: number; body: unknown }> {
  const input = isRecord(raw) ? raw : {};
  return tx(async (db) => {
    const line = await lineFor(db, user, lineId, true, true);
    const size = input.size_bytes;
    const sha = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : "";
    const sizeOk = Number.isInteger(size) && (size as number) >= 1 && (size as number) <= FILE_LIMIT;
    if (line.status === "Delivered" && sizeOk && SHA.test(sha) && sameFile(line, sha, size as number)) {
      return { status: 200, body: lineJson(await loadLine(db, line.mission_id, line.id)) };
    }
    if (sizeOk && SHA.test(sha)) refuseUpload(line, sha, size as number);
    else if (line.status !== "Surveyed") refuseUpload(line, "", -1);
    const errors: Record<string, string> = {};
    if (!sizeOk) errors.size_bytes = "The file must be 1 to 50,000,000 bytes";
    if (!SHA.test(sha)) errors.sha256 = "Enter the 64-character SHA-256 from the logger";
    if (Object.keys(errors).length) throw invalid(errors);
    const existing = await one<UploadRecord>(db, "SELECT * FROM uploads WHERE line_id = $1 AND size_bytes = $2 AND sha256 = $3 AND open", [line.id, size, sha]);
    if (existing) return { status: 200, body: { upload_id: existing.id, part_bytes: PART_BYTES, received_bytes: Number(existing.received_bytes) } };
    const id = newId("u");
    await db.query("INSERT INTO uploads (id, line_id, size_bytes, sha256, created_at) VALUES ($1,$2,$3,$4,$5)", [id, line.id, size, sha, new Date()]);
    return { status: 201, body: { upload_id: id, part_bytes: PART_BYTES, received_bytes: 0 } };
  });
}

const RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

/** One part, starting exactly at received_bytes; the completing part stores the whole file as one object. */
export async function uploadPart(req: IncomingMessage, lineId: string, uploadId: string): Promise<{ status: number; body: unknown }> {
  checkRawBody(req, PART_BYTES);
  const user = await requireUser(req);
  await lineFor(pool, user, lineId, true);
  const data = await readBody(req, PART_BYTES);
  const range = RANGE.exec(String(req.headers["content-range"] ?? ""));
  return tx(async (db) => {
    const line = await lineFor(db, user, lineId, true, true);
    const upload = await one<UploadRecord>(db, "SELECT * FROM uploads WHERE id = $1 AND line_id = $2 AND open FOR UPDATE", [uploadId, line.id]);
    if (!upload) throw notFound();
    const received = Number(upload.received_bytes);
    const size = Number(upload.size_bytes);
    if (!range || Number(range[1]) !== received) throw conflict("range_mismatch", "This part does not start where the upload stopped.", { received_bytes: received });
    if (Number(range[2]) - Number(range[1]) + 1 !== data.length || Number(range[3]) !== size || received + data.length > size || !data.length) {
      throw invalid({ content_range: "Send Content-Range matching the part's bytes" });
    }
    if (received + data.length < size) {
      await db.query("INSERT INTO upload_parts (upload_id, first_byte, data) VALUES ($1,$2,$3)", [upload.id, received, data]);
      await db.query("UPDATE uploads SET received_bytes = $2 WHERE id = $1", [upload.id, received + data.length]);
      return { status: 200, body: { received_bytes: received + data.length } };
    }
    const parts = (await db.query<{ data: Buffer }>("SELECT data FROM upload_parts WHERE upload_id = $1 ORDER BY first_byte", [upload.id])).rows.map((r) => r.data);
    const whole = Buffer.concat([...parts, data]);
    const sha = createHash("sha256").update(whole).digest("hex");
    if (sha !== upload.sha256) {
      await db.query("DELETE FROM upload_parts WHERE upload_id = $1", [upload.id]);
      await db.query("UPDATE uploads SET open = false WHERE id = $1", [upload.id]);
      return { status: 422, body: errorBody(invalid({ sha256: "Checksum does not match this file. Nothing was stored." })) };
    }
    if (status.storage === "down") throw storageUnavailable();
    refuseUpload(line, sha, whole.length);
    const name = headerValue(req, "X-Line-File-Name") || `${line.label}.raw`;
    if (!FILE_NAME.test(name)) throw invalid({ file_name: "Use a file name of 1 to 120 letters, digits, dots, underscores or hyphens" });
    try {
      await putObject(objectKey(line, name), whole, sha, "application/octet-stream");
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable();
      throw error;
    }
    await db.query("DELETE FROM upload_parts WHERE upload_id = $1", [upload.id]);
    await db.query("UPDATE uploads SET open = false, received_bytes = size_bytes WHERE id = $1", [upload.id]);
    return { status: 201, body: lineJson(await recordStored(db, line, name, whole.length, sha)) };
  });
}

/** Streams a stored object; leaving mid-stream aborts the storage read at once. */
async function stream(res: ServerResponse, key: string, headers: Record<string, string>): Promise<void> {
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  let response: Response;
  try {
    response = await getObject(key, abort.signal);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
  const length = response.headers.get("content-length");
  res.writeHead(200, { ...headers, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(length ? { "Content-Length": length } : {}) });
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  body.on("error", () => res.destroy());
  body.pipe(res);
}

export async function downloadLineFile(res: ServerResponse, user: UserRecord, lineId: string): Promise<void> {
  const line = await lineFor(pool, user, lineId, false);
  if (status.storage === "down") throw storageUnavailable();
  if (line.file_state !== "Stored") throw conflict("file_not_stored", `${line.label} has no stored file yet.`);
  await stream(res, objectKey(line, line.file_name), {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${line.file_name}"`,
    "X-Content-SHA256": line.file_sha256,
  });
}

export async function readReport(res: ServerResponse, user: UserRecord, missionId: string): Promise<void> {
  const m = await missionFor(pool, user, missionId);
  if (status.storage === "down") throw storageUnavailable();
  if (m.report_state !== "Ready") throw conflict("report_not_ready", "The coverage report is not ready yet.");
  await stream(res, reportKey(m.id), { "Content-Type": "application/json", "X-Content-SHA256": m.report_sha256 });
}

export const reportKey = (missionId: string) => `reports/${missionId}/coverage-report.json`;
