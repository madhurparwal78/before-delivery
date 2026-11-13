import { PICTURE_LIMIT_BYTES } from "../shared/schemas.js";
import { apiError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import type { StoredImage } from "./rooms/snapshot.js";
import { putObject, statObject } from "./s3.js";

type PictureFormat = { extension: "png" | "jpg" | "webp"; contentType: string };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

// The one place that judges a picture by its leading bytes alone.
function sniff(bytes: Buffer): PictureFormat | null {
  if (bytes.subarray(0, PNG.length).equals(PNG)) return { extension: "png", contentType: "image/png" };
  if (bytes.subarray(0, JPEG.length).equals(JPEG)) return { extension: "jpg", contentType: "image/jpeg" };
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  return null;
}

// Checks run in the published order; MinIO is contacted last. Returns the stored object only once it is stat-confirmed.
export async function storePicture(questionId: string, file: Buffer | null): Promise<StoredImage> {
  if (file === null || file.length === 0) throw apiError(422, "empty_file");
  if (file.length > PICTURE_LIMIT_BYTES) throw apiError(413, "image_too_large");
  const format = sniff(file);
  if (!format) throw apiError(415, "unsupported_type");
  const key = `questions/${questionId}/${sha256Hex(file)}.${format.extension}`;
  await putObject(key, file, format.contentType);
  const stat = await statObject(key);
  return { key, contentType: stat.contentType || format.contentType, bytes: stat.bytes };
}
