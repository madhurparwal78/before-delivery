import { createHash } from "node:crypto";
import sharp from "sharp";
import { PHOTO_BYTES_LIMIT, PHOTO_COUNT_LIMIT, PHOTO_PIXEL_LIMIT, photoSignature } from "../../shared/photoRules.js";
import { FIELD } from "../errors.js";
const THUMB_EDGE = 320;

type Format = { type: "jpeg" | "png" | "webp"; contentType: string };
const FORMATS = {
  jpeg: { type: "jpeg", contentType: "image/jpeg" },
  png: { type: "png", contentType: "image/png" },
  webp: { type: "webp", contentType: "image/webp" },
} as const satisfies Record<string, Format>;

export type Upload = { filename: string | null; data: Buffer };
export type ProcessedPhoto = {
  filename: string;
  contentType: string;
  original: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  uploadSha256: string;
};

function detect(data: Buffer): Format | null {
  const type = photoSignature(data);
  return type ? FORMATS[type] : null;
}

// Width and height declared in the header, read without decoding any pixel data.
function declaredSize(format: Format, data: Buffer): { width: number; height: number } | null {
  if (format.type === "png") {
    if (data.length < 24 || data.subarray(12, 16).toString("latin1") !== "IHDR") return null;
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (format.type === "webp") {
    const chunk = data.subarray(12, 16).toString("latin1");
    if (chunk === "VP8 " && data.length >= 30) return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L" && data.length >= 25) {
      const bits = data.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X" && data.length >= 30) return { width: data.readUIntLE(24, 3) + 1, height: data.readUIntLE(27, 3) + 1 };
    return null;
  }
  let at = 2;
  while (at + 4 <= data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = data.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > data.length) return null;
      return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) };
    }
    at += 2 + length;
  }
  return null;
}

function storedFilename(raw: string | null): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
  return cleaned === "" ? "photo" : cleaned;
}

export function uploadDigest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

type Verdict = { ok: true; format: Format } | { ok: false; reason: string };

// The photo acceptance checks, in the published order: type, size, declared pixels.
function judge(upload: Upload): Verdict {
  const name = storedFilename(upload.filename);
  const format = detect(upload.data);
  const size = format ? declaredSize(format, upload.data) : null;
  if (!format || !size || size.width === 0 || size.height === 0) return { ok: false, reason: FIELD.filesWrongType(name) };
  if (upload.data.length > PHOTO_BYTES_LIMIT) return { ok: false, reason: FIELD.filesTooLarge(name) };
  if (size.width * size.height > PHOTO_PIXEL_LIMIT) return { ok: false, reason: FIELD.filesTooManyPixels(name) };
  return { ok: true, format };
}

async function reencode(format: Format, data: Buffer): Promise<{ original: Buffer; width: number; height: number }> {
  const pipeline = sharp(data, { limitInputPixels: PHOTO_PIXEL_LIMIT, failOn: "error" }).rotate().toColourspace("srgb");
  const encoded = format.type === "jpeg" ? pipeline.jpeg({ quality: 90 }) : format.type === "png" ? pipeline.png() : pipeline.webp({ quality: 90 });
  const { data: original, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { original, width: info.width, height: info.height };
}

// Returns the processed photos, or the single `files` reason that refuses the send.
export async function acceptPhotos(uploads: Upload[]): Promise<{ photos: ProcessedPhoto[] } | { reason: string }> {
  if (uploads.length > PHOTO_COUNT_LIMIT) return { reason: FIELD.filesTooMany };
  const verdicts = uploads.map(judge);
  const refused = verdicts.find((v): v is Extract<Verdict, { ok: false }> => !v.ok);
  if (refused) return { reason: refused.reason };
  const photos: ProcessedPhoto[] = [];
  for (const [index, upload] of uploads.entries()) {
    const verdict = verdicts[index];
    if (!verdict?.ok) continue;
    const filename = storedFilename(upload.filename);
    try {
      const { original, width, height } = await reencode(verdict.format, upload.data);
      const thumb = await sharp(original).resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      photos.push({ filename, contentType: verdict.format.contentType, original, thumb, width, height, uploadSha256: uploadDigest(upload.data) });
    } catch {
      return { reason: FIELD.filesWrongType(filename) };
    }
  }
  return { photos };
}
