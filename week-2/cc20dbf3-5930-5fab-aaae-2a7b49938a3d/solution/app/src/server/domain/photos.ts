// Condition photos: type judged from the first bytes, size capped, stage taken from the loan's state when
// the record is created, at most 4 per stage, stored under a server-made key.

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import busboy from "busboy";
import type { LoanStatus, Photo, PhotoStage } from "../../shared/api.js";
import { FIELD_COPY } from "../../shared/copy.js";
import { pool, withTransaction } from "../db.js";
import { ApiError } from "../http/errors.js";
import { UPLOAD_LIMIT } from "../http/route.js";
import { deleteObject, getObject, putObject, StorageUnavailable } from "../services/storage.js";
import { assertLoanMove } from "./loans.js";
import { readLoan } from "./records.js";

const PHOTO_MAX_BYTES = 5_000_000;
const STAGE_PHOTOS = 4;

interface ImageType {
  contentType: string;
  extension: "jpg" | "png" | "webp";
}

function sniffImage(data: Buffer): ImageType | null {
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { contentType: "image/jpeg", extension: "jpg" };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: "image/png", extension: "png" };
  }
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") {
    return { contentType: "image/webp", extension: "webp" };
  }
  return null;
}

interface PhotoUpload {
  data: Buffer;
  type: ImageType;
}

/** Reads the multipart body: 413 past the upload limit, 422 without a `photo` file, then the photo checks
 * (415 for anything but JPEG, PNG or WebP, 413 past the photo limit). The device's file name is ignored. */
export function readPhotoUpload(req: IncomingMessage): Promise<PhotoUpload> {
  return new Promise((resolve, reject) => {
    let parser: busboy.Busboy;
    try {
      parser = busboy({ headers: req.headers, limits: { fileSize: PHOTO_MAX_BYTES + 1, files: 4, fields: 20 } });
    } catch {
      reject(ApiError.of("unsupported_media_type"));
      return;
    }
    let photo: { chunks: Buffer[]; truncated: boolean } | null = null;
    let received = 0;
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      outcome();
    };

    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > UPLOAD_LIMIT) {
        req.unpipe(parser);
        req.pause();
        finish(() => reject(ApiError.of("body_too_large")));
      }
    });
    parser.on("file", (name, stream) => {
      if (name !== "photo" || photo) {
        stream.resume();
        return;
      }
      const current = { chunks: [] as Buffer[], truncated: false };
      photo = current;
      stream.on("data", (chunk: Buffer) => current.chunks.push(chunk));
      stream.on("limit", () => {
        current.truncated = true;
      });
    });
    parser.on("error", () => finish(() => reject(ApiError.validation({ photo: FIELD_COPY.required }))));
    parser.on("close", () =>
      finish(() => {
        if (!photo) return reject(ApiError.validation({ photo: FIELD_COPY.required }));
        const data = Buffer.concat(photo.chunks);
        const type = sniffImage(data);
        if (!type) return reject(ApiError.of("unsupported_photo"));
        if (photo.truncated || data.length > PHOTO_MAX_BYTES) return reject(ApiError.of("photo_too_large"));
        resolve({ data, type });
      }),
    );
    req.pipe(parser);
  });
}

/** The stage a photo takes from its loan's state: checkout while out, return once returned. */
function stageFor(status: LoanStatus): PhotoStage {
  assertLoanMove("photo", status);
  return status === "returned" ? "return" : "checkout";
}

export async function addPhoto(loanId: string, upload: PhotoUpload, now: Date): Promise<Photo> {
  const written: { key?: string } = {};
  try {
    return await withTransaction(async (db) => {
      const loan = await readLoan(db, now, loanId, true);
      if (!loan) throw ApiError.of("not_found");
      const stage = stageFor(loan.status);
      const count = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM photo WHERE loan_id = $1 AND stage = $2", [loanId, stage]);
      if ((count.rows[0]?.n ?? 0) >= STAGE_PHOTOS) throw ApiError.of("photo_limit");
      const id = randomUUID();
      const key = `loans/${loanId}/${stage}/${id}.${upload.type.extension}`;
      await db.query("INSERT INTO photo (id, loan_id, stage, content_type, size_bytes, object_key) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        loanId,
        stage,
        upload.type.contentType,
        upload.data.length,
        key,
      ]);
      written.key = key;
      await putObject(key, upload.data, upload.type.contentType);
      return { id, stage, content_type: upload.type.contentType, size_bytes: upload.data.length, url: `/api/loans/${loanId}/photos/${id}` };
    });
  } catch (error) {
    if (written.key) await deleteObject(written.key).catch(() => undefined);
    if (error instanceof StorageUnavailable) throw ApiError.of("photo_storage_unavailable");
    throw error;
  }
}

export async function findPhotoKey(loanId: string, photoId: string): Promise<{ key: string; contentType: string }> {
  const found = await pool.query<{ object_key: string; content_type: string }>(
    "SELECT object_key, content_type FROM photo WHERE id::text = $1 AND loan_id = $2",
    [photoId, loanId],
  );
  const row = found.rows[0];
  if (!row) throw ApiError.of("not_found");
  return { key: row.object_key, contentType: row.content_type };
}

export async function photoBytes(key: string): Promise<Buffer> {
  try {
    return await getObject(key);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw ApiError.of("photo_storage_unavailable");
    throw error;
  }
}
