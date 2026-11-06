// Camera clips: announce, receive bytes, and confirm against object storage before marking stored.
// Clip confirmation is decided here and nowhere else.

import { randomUUID } from "node:crypto";
import type { Clip, ClipState } from "../shared/types.ts";
import { parseInstant } from "../shared/zone.ts";
import { pool, rows, transaction, type Queryable } from "./db.ts";
import { ApiError, FIELD, FieldErrors } from "./errors.ts";
import { householdZone } from "./plan.ts";
import { announce, writeMotion } from "./notices.ts";
import { broadcast } from "./socket.ts";
import { reportService } from "./status.ts";
import { deleteObject, getObject, objectSize, putObject, StorageUnavailable } from "./storage.ts";

export const MAX_CLIP_BYTES = 20_000_000;

interface ClipRow {
  id: string;
  camera_id: string;
  camera_name: string;
  recorded_at: Date;
  day: string;
  declared_size: number;
  stored_size: number | null;
  state: ClipState;
  object_key: string;
}

const SELECT = `SELECT c.id, c.camera_id, d.name AS camera_name, c.recorded_at, c.day, c.declared_size,
  c.stored_size, c.state, c.object_key FROM clips c JOIN devices d ON d.id = c.camera_id`;

async function toClip(row: ClipRow): Promise<Clip> {
  const zone = await householdZone();
  return { ...row, recorded_at: zone.iso(row.recorded_at.getTime()), playable: row.state === "stored" };
}

async function clipRow(id: string, db: Queryable = pool): Promise<ClipRow> {
  const [row] = await rows<ClipRow>(db, `${SELECT} WHERE c.id = $1`, [id]);
  if (!row) throw ApiError.of("not_found");
  return row;
}

export async function getClip(id: string): Promise<Clip> {
  return toClip(await clipRow(id));
}

export async function listClips(day: string): Promise<Clip[]> {
  return Promise.all((await rows<ClipRow>(pool, `${SELECT} WHERE c.day = $1 ORDER BY c.recorded_at, c.id`, [day])).map(toClip));
}

async function pushClip(id: string): Promise<Clip> {
  const clip = await getClip(id);
  broadcast({ type: "clip", clip });
  return clip;
}

/** POST /api/sim/cameras/{device_id}/clips */
export async function announceClip(cameraId: string, body: unknown): Promise<Clip> {
  const [camera] = await rows<{ id: string }>(pool, "SELECT id FROM devices WHERE id = $1 AND kind = 'camera'", [cameraId]);
  if (!camera) throw ApiError.of("not_found");
  const request = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors = new FieldErrors();
  const recordedAt = parseInstant(request.recorded_at);
  if (recordedAt === null) errors.add("recorded_at", FIELD.instant);
  const size = request.declared_size;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > MAX_CLIP_BYTES) {
    errors.add("declared_size", FIELD.declaredSize);
  }
  errors.throwIfAny();
  const zone = await householdZone();
  const id = randomUUID();
  const day = zone.day(recordedAt as number);
  await pool.query(
    "INSERT INTO clips (id, camera_id, recorded_at, day, declared_size, state, object_key) VALUES ($1, $2, $3, $4, $5, 'announced', $6)",
    [id, cameraId, new Date(recordedAt as number), day, size, `clips/${cameraId}/${day}/${id}.mp4`],
  );
  const clip = await getClip(id);
  broadcast({ type: "clip", clip });
  return clip;
}

/**
 * PUT /api/sim/clips/{id}/bytes: claims the clip for storing (only while announced or storing), writes
 * the bytes to storage, then asks storage for the object's size; the clip becomes stored only when that
 * size equals the declared size, in the same transaction as its motion notice.
 */
export async function receiveClipBytes(id: string, bytes: Buffer): Promise<Clip> {
  const row = await clipRow(id);
  const claimed = await pool.query(
    "UPDATE clips SET state = 'storing' WHERE id = $1 AND state IN ('announced', 'storing') RETURNING state", [id],
  );
  if (claimed.rowCount === 0) throw ApiError.of("clip_closed");
  if (row.state === "announced") await pushClip(id);
  let reported: number | null;
  try {
    await putObject(row.object_key, bytes, "video/mp4");
    reported = await objectSize(row.object_key);
    if (reported !== row.declared_size) await deleteObject(row.object_key);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    reportService("storage", false);
    throw ApiError.of("storage_unavailable");
  }
  if (reported !== row.declared_size) {
    const closed = await pool.query(
      "UPDATE clips SET state = 'size_mismatch', stored_size = $2 WHERE id = $1 AND state = 'storing'", [id, reported],
    );
    if (closed.rowCount === 0) throw ApiError.of("clip_closed");
    await pushClip(id);
    throw ApiError.of("size_mismatch", String(reported ?? 0), String(row.declared_size));
  }
  const size = reported;
  const notice = await transaction(async (client) => {
    const stored = await client.query(
      "UPDATE clips SET state = 'stored', stored_size = $2 WHERE id = $1 AND state = 'storing'", [id, size],
    );
    if (stored.rowCount === 0) throw ApiError.of("clip_closed");
    return writeMotion(client, id, row.camera_name, row.recorded_at.getTime(), size);
  });
  const clip = await pushClip(id);
  await announce([notice]);
  return clip;
}

/** GET /api/clips/{id}/media: the stored bytes, streamed from storage. */
export async function clipMedia(id: string): Promise<{ size: number; body: ReadableStream<Uint8Array> }> {
  const row = await clipRow(id);
  if (row.state !== "stored") throw ApiError.of("clip_not_playable");
  try {
    const response = await getObject(row.object_key);
    return { size: row.stored_size as number, body: response.body as ReadableStream<Uint8Array> };
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    reportService("storage", false);
    throw ApiError.of("storage_unavailable");
  }
}
