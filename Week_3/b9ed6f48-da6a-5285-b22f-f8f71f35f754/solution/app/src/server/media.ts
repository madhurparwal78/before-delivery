// Media uploads and links (brief: Services › MinIO › Media, Upload types, Links).

import { randomUUID } from "node:crypto";
import { one, pool, tx } from "./db.js";
import { recordAction } from "./audit.js";
import { itemStatus } from "./archive.js";
import { assertValid, fail, redirect, type Fields, type Reply, type Upload } from "./http.js";
import { objectExists, presignedUrl, putObject, StorageUnreachable } from "./storage.js";
import { COPY } from "../shared/copy.js";
import type { SessionUser } from "./signin.js";

const UPLOAD_FILE_LIMIT = 20_000_000;
type Kind = "narration" | "image" | "scan";

const ACCEPTED: Record<Kind, string[]> = {
  narration: ["audio/mpeg", "audio/ogg"],
  image: ["image/png", "image/jpeg", "image/webp"],
  scan: ["image/png", "image/jpeg", "application/pdf"],
};

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "audio/mpeg": (b) => b.subarray(0, 3).toString("latin1") === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  "audio/ogg": (b) => b.subarray(0, 4).toString("latin1") === "OggS",
};

/** Lowercased; anything but letters, digits, `.`, `_` and `-` becomes `-`. */
function storedFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

export async function uploadMedia(user: SessionUser, upload: Upload): Promise<Reply> {
  const itemId = upload.fields.item_id ?? "";
  if (!(await itemStatus(itemId))) throw fail.notFound();
  const kind = upload.fields.kind as Kind;
  const fields: Fields = {};
  if (!(kind in ACCEPTED)) fields.kind = "Choose narration, image or scan.";
  const file = upload.file;
  if (!file || file.data.length === 0) fields.file = "Choose a file to upload.";
  else if (file.data.length > UPLOAD_FILE_LIMIT) fields.file = COPY.fileSize;
  else if (kind in ACCEPTED && (!ACCEPTED[kind].includes(file.contentType) || !SIGNATURES[file.contentType](file.data))) fields.file = COPY.fileType;
  const transcript = (upload.fields.transcript ?? "").trim();
  if (kind === "narration" && !transcript) fields.transcript = COPY.transcriptField;
  assertValid(fields);
  const accepted = file as NonNullable<Upload["file"]>;
  const id = randomUUID();
  const filename = storedFileName(accepted.filename);
  const key = `media/${id}/${filename}`;
  try {
    await putObject(key, accepted.data, accepted.contentType);
  } catch (error) {
    if (error instanceof StorageUnreachable) throw fail.storage(COPY.storageUpload);
    throw error;
  }
  const media = { id, kind, item_id: itemId, filename, bytes: accepted.data.length, content_type: accepted.contentType, key };
  await tx(async (db) => {
    await db.query("INSERT INTO media (id, item_id, kind, filename, bytes, content_type, key, transcript) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
      id,
      itemId,
      kind,
      filename,
      media.bytes,
      media.content_type,
      key,
      kind === "narration" ? transcript : null,
    ]);
    await recordAction(db, user.email, "media_uploaded", itemId.startsWith("chapter-") ? "chapter" : "event", itemId, { media_id: id, kind, filename });
  });
  return { status: 201, body: { media } };
}

/** 302 to a presigned link, 404 unless the item is published (staff always), 503 when storage is down. */
export async function mediaLink(id: string, staff: boolean): Promise<Reply> {
  const media = await one<{ key: string; item_id: string }>(pool, "SELECT key, item_id FROM media WHERE id = $1", [id]);
  if (!media) throw fail.notFound();
  const status = await itemStatus(media.item_id);
  if (!staff && status?.status !== "published") throw fail.notFound();
  const stored = await objectExists(media.key).catch((error: unknown) => {
    if (error instanceof StorageUnreachable) return false;
    throw error;
  });
  if (!stored) throw fail.storage();
  return redirect(presignedUrl(media.key));
}
