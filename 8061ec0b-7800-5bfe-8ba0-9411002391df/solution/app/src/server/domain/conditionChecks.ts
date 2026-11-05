// Condition checks with photos: every check on every photo finishes before any object is written; the event and
// its photos commit only after every object is stored, and a failed write deletes what this request wrote.

import type { ConditionEvent, User } from "../../shared/api.js";
import { isoSecond } from "../../shared/storeTime.js";
import { CONDITION_KINDS, type ConditionKind } from "../../shared/vocabulary.js";
import { nowSecond } from "../clock.js";
import { pool, query, transaction, withClient } from "../db/pool.js";
import { ApiError, notFound, validationFailed } from "../http/errors.js";
import { newId, oneOf, randomToken } from "../http/fields.js";
import type { Multipart, Reply } from "../http/router.js";
import { encodeJpeg, judgePhoto } from "../services/images.js";
import { conditionPhotoKey, deleteWritten, getObject, putObject } from "../services/storage.js";
import { canSee, loadContractRow, requireVisible } from "./contracts.js";

const OPEN_FOR_CONDITION = ["signed", "active", "exchanged", "returned"];

function photoRefusal(status: number, code: string, message: string, index: number, fields?: Record<string, string>): ApiError {
  return new ApiError(status, code, message, { ...(fields ? { fields } : {}), photo_index: index });
}

export async function recordConditionCheck(user: User, id: string, upload: Multipart | null): Promise<unknown> {
  const row = await requireVisible(user, id);
  if (!OPEN_FOR_CONDITION.includes(row.status)) {
    throw new ApiError(409, "contract_not_open", "Condition can't be recorded on this contract.");
  }
  const form = upload ?? { fields: {}, files: [] };
  const kind: ConditionKind | null = oneOf(form.fields.kind, CONDITION_KINDS);
  if (kind === null) throw validationFailed({ kind: "invalid" });
  const notes = (form.fields.notes ?? "").trim();
  if ([...notes].length > 1_000) throw validationFailed({ notes: "too_long" });
  if (form.files.length < 1 || form.files.length > 6) throw validationFailed({ photos: "count" });
  const jpegs: Buffer[] = [];
  for (const [index, file] of form.files.entries()) {
    if (file.tooLarge) throw photoRefusal(413, "photo_too_large", "A photo is over 5,000,000 bytes.", index);
    const verdict = await judgePhoto(file.bytes);
    if (verdict.kind === "unsupported") {
      throw photoRefusal(415, "unsupported_image", "A photo isn't a JPEG, PNG or WebP image.", index);
    }
    if (verdict.kind === "dimensions") {
      throw photoRefusal(422, "validation_failed", "A photo is over 8,000 pixels on a side.", index, { photos: "dimensions" });
    }
    jpegs.push(encodeJpeg(verdict));
  }
  const eventId = newId("E");
  const photoIds = jpegs.map(() => randomToken(18));
  const written: string[] = [];
  try {
    for (const [i, jpeg] of jpegs.entries()) {
      const key = conditionPhotoKey(id, eventId, photoIds[i]);
      await putObject(key, jpeg, "image/jpeg");
      written.push(key);
    }
    const at = nowSecond();
    await transaction(async (db) => {
      await db.query(`INSERT INTO condition_events (id, contract_id, kind, notes, recorded_by, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [eventId, id, kind, notes, user.name, at]);
      for (const [position, photoId] of photoIds.entries()) {
        await db.query("INSERT INTO condition_photos (id, event_id, contract_id, position) VALUES ($1, $2, $3, $4)",
          [photoId, eventId, id, position]);
      }
    });
    return { event: { id: eventId, kind, notes, recorded_by: user.name, created_at: isoSecond(at),
      photos: photoIds.map((photoId) => ({ id: photoId, url: `/api/condition-photos/${photoId}` })) } };
  } catch (error) {
    await deleteWritten(written);
    throw error;
  }
}

export async function listConditionChecks(user: User, id: string): Promise<{ events: ConditionEvent[] }> {
  await requireVisible(user, id);
  const events = await query<{ id: string; kind: ConditionKind; notes: string; recorded_by: string; created_at: Date }>(pool,
    "SELECT id, kind, notes, recorded_by, created_at FROM condition_events WHERE contract_id = $1 ORDER BY created_order DESC", [id]);
  const photos = await query<{ id: string; event_id: string }>(pool,
    "SELECT id, event_id FROM condition_photos WHERE contract_id = $1 ORDER BY position", [id]);
  return { events: events.map((e) => ({ id: e.id, kind: e.kind, notes: e.notes, recorded_by: e.recorded_by,
    created_at: isoSecond(e.created_at),
    photos: photos.filter((p) => p.event_id === e.id).map((p) => ({ id: p.id, url: `/api/condition-photos/${p.id}` })) })) };
}

export async function conditionPhoto(user: User, photoId: string): Promise<Reply> {
  const [photo] = await query<{ event_id: string; contract_id: string }>(pool,
    "SELECT event_id, contract_id FROM condition_photos WHERE id = $1", [photoId]);
  const row = photo && await withClient((db) => loadContractRow(db, photo.contract_id));
  if (photo === undefined || row === undefined || !canSee(user, row)) throw notFound();
  const bytes = await getObject(conditionPhotoKey(photo.contract_id, photo.event_id, photoId));
  if (bytes === null) throw notFound();
  return { status: 200, bytes, type: "image/jpeg" };
}
