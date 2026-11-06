// Upload checks (Business rules › Uploads), judged on the complete received bytes, in the stated order.
import { fileTooLarge, invalid, unsupportedType } from "../errors.js";

type AssetKind = "model" | "texture";

const LIMITS: Record<AssetKind, number> = { model: 20_000_000, texture: 8_000_000 };
const MAX_TEXTURE_PX = 4096;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface CheckedUpload { kind: AssetKind; name: string; contentType: string }

function nameAllowed(name: string): boolean {
  const length = [...name].length;
  return length >= 1 && length <= 120 && !/[/\\]/.test(name) && !name.includes("..") && !/[\u0000-\u001f\u007f]/.test(name);
}

function contentType(kind: AssetKind, name: string, bytes: Buffer): string | null {
  const lower = name.toLowerCase();
  if (kind === "model") {
    const isGlb = bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "glTF"
      && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length;
    return isGlb && lower.endsWith(".glb") ? "model/gltf-binary" : null;
  }
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE) && lower.endsWith(".png")) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))) return "image/jpeg";
  return null;
}

function pngSize(bytes: Buffer): [number, number] | null {
  return bytes.length >= 24 && bytes.toString("latin1", 12, 16) === "IHDR" ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : null;
}

function jpegSize(bytes: Buffer): [number, number] | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}

/** Kind and name (422), size against the declared kind's limit (413), content (415), texture dimensions (422). */
export function checkUpload(kind: unknown, name: string, bytes: Buffer): CheckedUpload {
  if (kind !== "model" && kind !== "texture") throw invalid({ kind: "Use model or texture" });
  if (!nameAllowed(name)) throw invalid({ file: "File name is not allowed" });
  if (bytes.length > LIMITS[kind]) throw fileTooLarge(LIMITS[kind]);
  const type = contentType(kind, name, bytes);
  if (!type) throw unsupportedType();
  if (kind === "texture") {
    const size = type === "image/png" ? pngSize(bytes) : jpegSize(bytes);
    if (!size) throw unsupportedType();
    if (size[0] > MAX_TEXTURE_PX || size[1] > MAX_TEXTURE_PX) throw invalid({ file: "Texture is larger than 4096 by 4096 pixels" });
  }
  return { kind, name, contentType: type };
}

/** Splits a multipart/form-data body into its text fields and its one file. */
export function parseMultipart(contentTypeHeader: string | undefined, body: Buffer): { fields: Record<string, string>; file: { name: string; bytes: Buffer } | null } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader ?? "");
  if (!boundary) throw invalid({ file: "Send the upload as multipart/form-data" });
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields: Record<string, string> = {};
  let file: { name: string; bytes: Buffer } | null = null;
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next < 0) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const head = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4);
      const fieldName = /name="([^"]*)"/i.exec(head)?.[1];
      const fileName = /filename\*?=(?:UTF-8'')?"?([^"\r\n]*)"?/i.exec(head)?.[1];
      if (fieldName === "file" && fileName !== undefined) file = { name: decodeURIComponentSafe(fileName), bytes: content };
      else if (fieldName) fields[fieldName] = content.toString("utf8");
    }
    start = next;
  }
  return { fields, file };
}

function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
