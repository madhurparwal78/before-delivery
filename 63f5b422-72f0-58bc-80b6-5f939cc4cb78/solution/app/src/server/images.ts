import { ApiError, imageTooLarge, invalid, notFound } from "../shared/errors.js";
import type { ImageRecord } from "../shared/types.js";
import { all, newId, one, pool } from "./db.js";
import { putConfirmed, StorageDown, storageUnavailable } from "./storage.js";

const MAX_IMAGE_BYTES = 5_000_000;

interface Part {
  fileName: string;
  data: Buffer;
}

/** The `file` part of a multipart/form-data body. */
export function filePart(contentType: string | undefined, raw: Buffer): Part {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!boundary) throw invalid({ file: "Send the image as multipart/form-data with one part named file." });
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let at = raw.indexOf(marker);
  while (at >= 0) {
    const start = at + marker.length + 2;
    const next = raw.indexOf(marker, start);
    if (next < 0) break;
    const part = raw.subarray(start, next - 2);
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString("utf8");
    if (/name="file"/i.test(head)) {
      const name = /filename="([^"]*)"/i.exec(head)?.[1] ?? "image";
      return { fileName: name.replace(/[\\/]/g, "_").slice(0, 200) || "image", data: part.subarray(split + 4) };
    }
    at = next;
  }
  throw invalid({ file: "Send the image as multipart/form-data with one part named file." });
}

/** The image type from its signature bytes (the declared type is ignored). */
export function imageType(data: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 12 && data.toString("latin1", 0, 4) === "RIFF" && data.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function dimensions(type: string, data: Buffer): { width: number; height: number } {
  try {
    if (type === "image/png") return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
    if (type === "image/webp") {
      const chunk = data.toString("latin1", 12, 16);
      if (chunk === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = data.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
    }
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = data[i + 1];
      const length = data.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
      i += 2 + length;
    }
  } catch {
    return { width: 0, height: 0 };
  }
  return { width: 0, height: 0 };
}

/** Where an uploaded image lives in storage. */
export function imageKey(workspaceId: string, imageId: string): string {
  return `images/${workspaceId}/${imageId}`;
}

/** The stored type of a confirmed image, or the not-found rule. */
export async function confirmedImageType(imageId: string): Promise<string> {
  const row = await one<{ mime: string }>(pool, "SELECT mime FROM images WHERE id = $1 AND status = 'confirmed'", [imageId]);
  if (!row) throw notFound();
  return row.mime;
}

/** Store an upload: write it, read it back, and only then mark it confirmed. */
export async function upload(workspaceId: string, part: Part): Promise<ImageRecord> {
  const type = imageType(part.data);
  if (!type) throw new ApiError(415, "unsupported_image", "Only PNG, JPEG or WebP images can be uploaded.");
  if (part.data.length > MAX_IMAGE_BYTES) throw imageTooLarge();
  const { width, height } = dimensions(type, part.data);
  const id = newId("img");
  await pool.query("INSERT INTO images (id, workspace_id, file_name, mime, width, height, status) VALUES ($1, $2, $3, $4, $5, $6, 'pending')", [id, workspaceId, part.fileName, type, width, height]);
  try {
    await putConfirmed(workspaceId, imageKey(workspaceId, id), part.data, type);
  } catch (error) {
    await pool.query("DELETE FROM images WHERE id = $1", [id]);
    if (error instanceof StorageDown) throw storageUnavailable();
    throw error;
  }
  await pool.query("UPDATE images SET status = 'confirmed' WHERE id = $1", [id]);
  return { id, status: "confirmed", fileName: part.fileName, width, height };
}

export async function confirmedImages(workspaceId: string): Promise<ImageRecord[]> {
  const rows = await all<{ id: string; file_name: string; width: number; height: number }>(
    pool,
    "SELECT id, file_name, width, height FROM images WHERE workspace_id = $1 AND status = 'confirmed' ORDER BY created_at",
    [workspaceId],
  );
  return rows.map((r) => ({ id: r.id, status: "confirmed", fileName: r.file_name, width: r.width, height: r.height }));
}
