import { settings } from "./config.js";
import { transaction, type Tx } from "./db.js";
import { Env } from "./env.js";
import { fail, notFound, storageUnavailable, validation } from "./errors.js";
import { publish } from "./live.js";
import type { UploadedFile } from "./multipart.js";
import { findRecord } from "./records.js";
import { getObject, isAvailable, putObject, StorageDown } from "./storage.js";

const ALLOWED: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", txt: "text/plain", log: "text/plain", csv: "text/csv" };

export interface AttachmentJson {
  id: number;
  name: string;
  bytes: number;
  type: string;
  status: "stored" | "queued";
}

function attachmentOf(row: Record<string, unknown>): AttachmentJson {
  return { id: row.id as number, name: row.name as string, bytes: row.bytes as number, type: row.type as string, status: row.status as "stored" | "queued" };
}

export async function attachmentsOf(tx: Tx, number: string): Promise<AttachmentJson[]> {
  return (await tx.query("SELECT id, name, bytes, type, status FROM attachments WHERE record_number = $1 ORDER BY id", [number])).map(attachmentOf);
}

function keyOf(number: string, id: number, name: string): string {
  return `attachments/${number}/${id}/${name}`;
}

/** Stores an attachment once storage accepts it; during an outage the bytes wait in Postgres and the answer is 202. */
export async function upload(env: Env, number: string, file: UploadedFile): Promise<{ status: 201 | 202; attachment: AttachmentJson }> {
  const rec = await findRecord(env.tx, number);
  const access = await env.access();
  if (!rec || !access.canRead(rec)) return notFound();
  const extension = file.filename.split(".").pop()?.toLowerCase() ?? "";
  const declared = file.type.split(";")[0]!.trim().toLowerCase();
  if (ALLOWED[extension] !== declared) fail(422, "bad_type", "Switchyard accepts PNG, JPEG, PDF, TXT, LOG and CSV files.");
  const used = await env.tx.query("SELECT coalesce(sum(bytes), 0)::bigint AS total FROM attachments WHERE uploader = $1", [env.user.username]);
  const total = Number(used[0]!.total);
  if (total + file.data.length > settings.ATTACHMENT_QUOTA_BYTES) {
    fail(422, "over_quota", `This upload would take you past your ${settings.ATTACHMENT_QUOTA_BYTES.toLocaleString("en-US")}-byte attachment quota.`);
  }
  if (file.data.length > settings.ATTACHMENT_MAX_BYTES) fail(413, "too_large", `Files can be at most ${settings.ATTACHMENT_MAX_BYTES.toLocaleString("en-US")} bytes.`);
  const name = file.filename.replace(/[/\\]/g, "_");
  const inserted = await env.tx.query<{ id: number }>("INSERT INTO attachments (record_number, name, bytes, type, status, uploader, data) VALUES ($1, $2, $3, $4, 'queued', $5, $6) RETURNING id", [number, name, file.data.length, declared, env.user.username, file.data]);
  const id = inserted[0]!.id;
  let status: 201 | 202 = 202;
  if (isAvailable()) {
    try {
      await putObject(keyOf(number, id, name), file.data, declared);
      await env.tx.query("UPDATE attachments SET status = 'stored', data = NULL WHERE id = $1", [id]);
      status = 201;
    } catch (error) {
      if (!(error instanceof StorageDown)) throw error;
    }
  }
  env.tx.after.push(() => publish(`record:${number}`, "changed", { number }));
  return { status, attachment: { id, name, bytes: file.data.length, type: declared, status: status === 201 ? "stored" : "queued" } };
}

export async function download(env: Env, id: number): Promise<{ type: string; data: Buffer }> {
  const rows = await env.tx.query("SELECT * FROM attachments WHERE id = $1", [id]);
  const row = rows[0];
  const rec = row ? await findRecord(env.tx, row.record_number as string) : null;
  const access = await env.access();
  if (!row || !rec || !access.canRead(rec)) return notFound();
  if (row.status !== "stored") fail(409, "not_stored", "This file is still waiting for storage.");
  if (!isAvailable()) return storageUnavailable();
  try {
    return { type: row.type as string, data: await getObject(keyOf(row.record_number as string, id, row.name as string)) };
  } catch (error) {
    if (error instanceof StorageDown) return storageUnavailable();
    throw error;
  }
}

/** Writes queued uploads in upload order once storage is back. */
export async function flushQueued(): Promise<void> {
  const queued = await transaction((tx) => tx.query("SELECT id, record_number, name, type, data FROM attachments WHERE status = 'queued' ORDER BY id"));
  for (const row of queued) {
    try {
      await putObject(keyOf(row.record_number as string, row.id as number, row.name as string), row.data as Buffer, row.type as string);
    } catch {
      return;
    }
    await transaction(async (tx) => {
      await tx.query("UPDATE attachments SET status = 'stored', data = NULL WHERE id = $1", [row.id]);
    });
    publish(`record:${row.record_number as string}`, "changed", { number: row.record_number });
  }
}

export async function queuedCount(tx: Tx): Promise<number> {
  const rows = await tx.query("SELECT count(*)::int AS n FROM attachments WHERE status = 'queued'");
  return rows[0]!.n as number;
}

export function requireFile(files: UploadedFile[]): UploadedFile {
  const file = files.find((f) => f.field === "file");
  if (!file) return validation("Attach a file in the field named file.", { file: "A file is required." });
  return file;
}
