import { createHash } from "node:crypto";
import type { MediaRecord, UploadRecord } from "../shared/types";
import { codePoints } from "../shared/codepoints";
import { FIELD_ERRORS, UPLOAD_REASONS } from "../shared/copy";
import { CHUNK_BYTES, UPLOAD_BYTES_MAX } from "../shared/limits";
import { rateOf, roundExact, secondsToFrames } from "../shared/rational";
import { allowance, allowanceExceeded, giveBackStorage, takeStorage } from "./allowance";
import { one, pool, query, tx } from "./db";
import { AppError, invalid, notFound } from "./errors";
import { newId } from "./ids";
import { kv } from "./kv";
import { judgeFile, type Judged, type RangeReader } from "./media/judge";
import { mediaById, mediaWords } from "./media/library";
import {
  abortMultipart,
  completeMultipart,
  createMultipart,
  deleteObject,
  getObject,
  headObject,
  putObject,
  reachable,
  StorageDown,
  uploadPart,
} from "./s3";
import { loadProjectRow, loadTimeline } from "./timeline/store";

interface UploadRow {
  id: string;
  person_id: string;
  file_name: string;
  folder: string;
  bytes: number;
  sha256: string;
  replaces: string | null;
  chunks: number;
  received: number[];
  state: "open" | "receiving" | "completing" | "confirmed" | "refused";
}

const chunkKey = (uploadId: string, n: number): string => `uploads/${uploadId}/${n}`;
const chunkCount = (bytes: number): number => Math.ceil(bytes / CHUNK_BYTES);
const expectedLength = (row: UploadRow, n: number): number => (n === row.chunks - 1 ? row.bytes - n * CHUNK_BYTES : CHUNK_BYTES);

async function assertStorage(): Promise<void> {
  if (!(await reachable())) throw new AppError("storage_unavailable");
}

function validName(name: unknown): name is string {
  return typeof name === "string" && codePoints(name) >= 1 && codePoints(name) <= 120 && !/[/\\\u0000-\u001f\u007f]/.test(name) && !name.startsWith(".");
}

function validFolder(folder: unknown): folder is string {
  if (typeof folder !== "string" || codePoints(folder) < 1 || codePoints(folder) > 80 || /[\u0000-\u001f\u007f]/.test(folder)) return false;
  return folder.split(" / ").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function shape(row: UploadRow): { upload_id: string; chunk_bytes: number; chunks: number; chunks_received: number[] } {
  return { upload_id: row.id, chunk_bytes: CHUNK_BYTES, chunks: row.chunks, chunks_received: [...row.received].sort((a, b) => a - b) };
}

export async function createUpload(personId: string, raw: unknown): Promise<{ status: 200 | 201; body: unknown }> {
  const input = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  if (!validName(input["file_name"])) errors["file_name"] = FIELD_ERRORS.file_name;
  if (!validFolder(input["folder"])) errors["folder"] = FIELD_ERRORS.other;
  const bytes = input["bytes"];
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 || bytes > UPLOAD_BYTES_MAX) errors["bytes"] = FIELD_ERRORS.other;
  const sha256 = input["sha256"];
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) errors["sha256"] = FIELD_ERRORS.other;
  const replaces = input["replaces"];
  if (replaces !== undefined && typeof replaces !== "string") errors["replaces"] = FIELD_ERRORS.other;
  if (Object.keys(errors).length) throw invalid(errors);
  const file = { name: input["file_name"] as string, folder: input["folder"] as string, bytes: bytes as number, sha256: sha256 as string };

  const existing = await one<{ id: string }>("SELECT id FROM media WHERE sha256 = $1", [file.sha256]);
  if (existing) return { status: 200, body: { duplicate: true, media: await mediaById(pool, existing.id) } };
  const open = await one<UploadRow>("SELECT * FROM uploads WHERE person_id = $1 AND sha256 = $2 AND state IN ('open','receiving') ORDER BY seq LIMIT 1", [personId, file.sha256]);
  if (open) {
    if (open.bytes !== file.bytes) throw invalid({ bytes: FIELD_ERRORS.other });
    return { status: 200, body: shape(open) };
  }
  const current = await allowance();
  if (current.storage_bytes_used + file.bytes > current.storage_bytes_allowance) throw allowanceExceeded(current);
  if (typeof replaces === "string" && !(await one("SELECT 1 FROM media WHERE id = $1", [replaces]))) throw notFound();
  await assertStorage();
  const row: UploadRow = {
    id: newId("u"),
    person_id: personId,
    file_name: file.name,
    folder: file.folder,
    bytes: file.bytes,
    sha256: file.sha256,
    replaces: typeof replaces === "string" ? replaces : null,
    chunks: chunkCount(file.bytes),
    received: [],
    state: "open",
  };
  const inserted = await one(
    `INSERT INTO uploads (id, person_id, file_name, folder, bytes, sha256, replaces, chunks) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (person_id, sha256) WHERE state IN ('open','receiving') DO NOTHING RETURNING id`,
    [row.id, row.person_id, row.file_name, row.folder, row.bytes, row.sha256, row.replaces, row.chunks],
  );
  if (inserted) return { status: 201, body: shape(row) };
  const raced = await one<UploadRow>("SELECT * FROM uploads WHERE person_id = $1 AND sha256 = $2 AND state IN ('open','receiving')", [personId, file.sha256]);
  if (!raced) throw notFound();
  return { status: 200, body: shape(raced) };
}

export async function listUploads(personId: string): Promise<UploadRecord[]> {
  const rows = await query<UploadRow>("SELECT * FROM uploads WHERE person_id = $1 AND state IN ('open','receiving') ORDER BY seq", [personId]);
  return rows.map((row) => ({
    upload_id: row.id,
    file_name: row.file_name,
    folder: row.folder,
    bytes: row.bytes,
    sha256: row.sha256,
    chunks: row.chunks,
    chunks_received: [...row.received].sort((a, b) => a - b),
    state: row.state === "receiving" ? "receiving" : "open",
  }));
}

async function ownUpload(personId: string, id: string): Promise<UploadRow> {
  const row = await one<UploadRow>("SELECT * FROM uploads WHERE id = $1 AND person_id = $2", [id, personId]);
  if (!row) throw notFound();
  return row;
}

export async function uploadState(personId: string, id: string): Promise<{ state: string; chunks_received: number[]; next_chunk: number | null }> {
  const row = await ownUpload(personId, id);
  const received = [...row.received].sort((a, b) => a - b);
  const next = Array.from({ length: row.chunks }, (_, n) => n).find((n) => !received.includes(n));
  return { state: row.state, chunks_received: received, next_chunk: row.state === "confirmed" || row.state === "refused" ? null : (next ?? null) };
}

export async function putChunk(personId: string, id: string, n: number, body: Buffer): Promise<void> {
  const row = await ownUpload(personId, id);
  if (row.state === "confirmed" || row.state === "refused") throw new AppError("upload_refused", { file: row.file_name, reason: row.state });
  if (!Number.isInteger(n) || n < 0 || n >= row.chunks || body.length !== expectedLength(row, n)) throw invalid({ chunk: FIELD_ERRORS.other });
  if (row.received.includes(n)) return;
  await assertStorage();
  await putObject(chunkKey(id, n), body);
  await query(
    "UPDATE uploads SET received = CASE WHEN $2 = ANY(received) THEN received ELSE array_append(received, $2) END, state = 'receiving' WHERE id = $1",
    [id, n],
  );
}

/** Chunk objects read as one file, one chunk held in memory at a time. */
function chunkedFile(row: UploadRow): RangeReader {
  let held: { n: number; bytes: Buffer } | null = null;
  const chunk = async (n: number): Promise<Buffer> => {
    if (held?.n === n) return held.bytes;
    const bytes = await getObject(chunkKey(row.id, n));
    if (!bytes) throw new StorageDown("chunk object missing");
    held = { n, bytes };
    return bytes;
  };
  return {
    size: row.bytes,
    async read(offset, length) {
      const parts: Buffer[] = [];
      let at = offset;
      const end = Math.min(offset + length, row.bytes);
      while (at < end) {
        const n = Math.floor(at / CHUNK_BYTES);
        const bytes = await chunk(n);
        const from = at - n * CHUNK_BYTES;
        const slice = bytes.subarray(from, Math.min(bytes.length, from + (end - at)));
        parts.push(slice);
        at += slice.length;
      }
      return Buffer.concat(parts);
    },
  };
}

async function dropChunks(row: UploadRow): Promise<void> {
  for (let n = 0; n < row.chunks; n += 1) await deleteObject(chunkKey(row.id, n)).catch(() => undefined);
}

async function refuse(row: UploadRow, reason: string): Promise<never> {
  await query("UPDATE uploads SET state = 'refused' WHERE id = $1", [row.id]);
  await dropChunks(row);
  throw new AppError("upload_refused", { file: row.file_name, reason }, { reason });
}

async function assemble(row: UploadRow, key: string): Promise<void> {
  if (row.chunks === 1) {
    const only = await getObject(chunkKey(row.id, 0));
    if (!only) throw new StorageDown("chunk object missing");
    await putObject(key, only);
    return;
  }
  const uploadId = await createMultipart(key);
  try {
    const tags: string[] = [];
    for (let n = 0; n < row.chunks; n += 1) {
      const part = await getObject(chunkKey(row.id, n));
      if (!part) throw new StorageDown("chunk object missing");
      tags.push(await uploadPart(key, uploadId, n + 1, part));
    }
    await completeMultipart(key, uploadId, tags);
  } catch (error) {
    await abortMultipart(key, uploadId);
    throw error;
  }
}

async function digest(row: UploadRow): Promise<string> {
  const hash = createHash("sha256");
  for (let n = 0; n < row.chunks; n += 1) {
    const part = await getObject(chunkKey(row.id, n));
    if (!part) throw new StorageDown("chunk object missing");
    hash.update(part);
  }
  return hash.digest("hex");
}

/** A replacement must be the same kind and long enough for every clip that uses the file. */
async function checkReplacement(media: Judged, replaces: string): Promise<string | null> {
  const old = await one<{ kind: string }>("SELECT kind FROM media WHERE id = $1", [replaces]);
  if (!old) throw notFound();
  if (old.kind !== media.kind) return UPLOAD_REASONS.replaceType;
  const uses = await query<{ project_id: string; title: string; source_out: number }>(
    "SELECT p.id AS project_id, p.title, MAX(c.source_out) AS source_out FROM clips c JOIN projects p ON p.id = c.project_id WHERE c.media_id = $1 GROUP BY p.id, p.title ORDER BY p.title",
    [replaces],
  );
  for (const use of uses) {
    const project = await loadProjectRow(pool, use.project_id);
    if (!project) continue;
    const timeline = await loadTimeline(pool, project);
    const longest = Math.max(...timeline.clips.filter((clip) => clip.media_id === replaces).map((clip) => clip.source_out));
    const frames = secondsToFrames(rateOf(project.frame_rate), media.src_num, media.src_den);
    if (frames < longest) return UPLOAD_REASONS.replaceShort(use.title);
  }
  return null;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function completeUpload(personId: string, id: string): Promise<{ status: 200 | 201; body: { duplicate: boolean; media: MediaRecord } }> {
  const row = await ownUpload(personId, id);
  if (row.state === "completing") {
    await pause(200);
    return completeUpload(personId, id);
  }
  if (row.state === "confirmed") {
    const media = await one<{ id: string }>("SELECT id FROM media WHERE sha256 = $1", [row.sha256]);
    const record = media ? await mediaById(pool, media.id) : null;
    if (record) return { status: 200, body: { duplicate: true, media: record } };
  }
  const missing = Array.from({ length: row.chunks }, (_, n) => n).filter((n) => !row.received.includes(n));
  if (missing.length) throw new AppError("upload_incomplete", { missing: missing.join(", ") }, { missing });
  await assertStorage();
  const claimed = await one<UploadRow>("UPDATE uploads SET state = 'completing' WHERE id = $1 AND state IN ('open','receiving') RETURNING *", [id]);
  if (!claimed) return completeUpload(personId, id);
  try {
    return await listUpload(claimed);
  } catch (error) {
    await query("UPDATE uploads SET state = 'receiving' WHERE id = $1 AND state = 'completing'", [id]);
    throw error;
  }
}

/** The steps of `complete`, in the published order, once the upload is claimed. */
async function listUpload(row: UploadRow): Promise<{ status: 200 | 201; body: { duplicate: boolean; media: MediaRecord } }> {
  if ((await digest(row)) !== row.sha256) return refuse(row, UPLOAD_REASONS.checksum);
  const verdict = await judgeFile(chunkedFile(row));
  if (!verdict.ok) return refuse(row, verdict.reason);
  const judged = verdict.media;
  if (row.replaces) {
    const reason = await checkReplacement(judged, row.replaces);
    if (reason) return refuse(row, reason);
  }
  const duplicate = await one<{ id: string }>("SELECT id FROM media WHERE sha256 = $1", [row.sha256]);
  if (duplicate) {
    await finish(row);
    const media = await mediaById(pool, duplicate.id);
    if (!media) throw notFound();
    return { status: 200, body: { duplicate: true, media } };
  }
  const replacing = row.replaces ? await one<{ bytes: number; sha256: string }>("SELECT bytes, sha256 FROM media WHERE id = $1", [row.replaces]) : undefined;
  if (!(await takeStorage(row.bytes))) throw allowanceExceeded(await allowance());
  let listed: MediaRecord | null = null;
  try {
    if (!(await headObject(`media/${row.sha256}`))) await assemble(row, `media/${row.sha256}`);
    listed = await tx(async (db) => {
      const mediaId = row.replaces ?? newId("m");
      const seconds = roundExact(judged.src_num * 1000n, judged.src_den) / 1000;
      const duration = judged.kind === "png" ? null : seconds;
      if (row.replaces) {
        await db.query(
          `UPDATE media SET kind=$2, bytes=$3, sha256=$4, width=$5, height=$6, duration_seconds=$7, sample_rate=$8,
             src_num=$9, src_den=$10 WHERE id=$1`,
          [mediaId, judged.kind, row.bytes, row.sha256, judged.width, judged.height, duration, judged.sample_rate, judged.src_num, judged.src_den],
        );
      } else {
        await db.query(
          `INSERT INTO media (id, name, kind, folder, bytes, sha256, width, height, duration_seconds, sample_rate, src_num, src_den, words)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            mediaId, row.file_name, judged.kind, row.folder, row.bytes, row.sha256, judged.width, judged.height, duration,
            judged.sample_rate, judged.src_num, judged.src_den, mediaWords(row.file_name, row.folder),
          ],
        );
      }
      return mediaById(db, mediaId);
    });
  } catch (error) {
    await giveBackStorage(row.bytes);
    throw error;
  }
  if (!listed) throw notFound();
  if (replacing) {
    await giveBackStorage(replacing.bytes);
    if (!(await one("SELECT 1 FROM media WHERE sha256 = $1", [replacing.sha256]))) {
      await deleteObject(`media/${replacing.sha256}`);
      await kv.del(`gatecut:peaks:${replacing.sha256}`);
    }
  }
  await finish(row);
  return { status: 201, body: { duplicate: false, media: listed } };
}

async function finish(row: UploadRow): Promise<void> {
  await query("UPDATE uploads SET state = 'confirmed' WHERE id = $1", [row.id]);
  await dropChunks(row);
}
