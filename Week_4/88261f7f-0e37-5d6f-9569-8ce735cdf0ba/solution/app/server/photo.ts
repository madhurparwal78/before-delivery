type PhotoKind = "jpeg" | "png";

const JPEG_START = [0xff, 0xd8, 0xff];
const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG or PNG judged by the file's own bytes. */
export function sniffPhoto(bytes: Buffer): PhotoKind | null {
  if (JPEG_START.every((value, index) => bytes[index] === value)) return "jpeg";
  if (PNG_START.every((value, index) => bytes[index] === value)) return "png";
  return null;
}

const KEPT_JPEG_SEGMENTS = new Set([0xe0, 0xe2, 0xee]);
const STANDALONE_MARKERS = new Set([0x01, 0xd8, 0xd9, ...Array.from({ length: 8 }, (_, index) => 0xd0 + index)]);
const START_OF_SCAN = 0xda;

function stripJpeg(bytes: Buffer): Buffer {
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    const marker = bytes[at + 1] ?? 0;
    if (bytes[at] !== 0xff) break;
    if (STANDALONE_MARKERS.has(marker)) {
      kept.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (marker === START_OF_SCAN) {
      kept.push(bytes.subarray(at));
      return Buffer.concat(kept);
    }
    const end = at + 2 + bytes.readUInt16BE(at + 2);
    const metadata = (marker >= 0xe0 && marker <= 0xef && !KEPT_JPEG_SEGMENTS.has(marker)) || marker === 0xfe;
    if (!metadata) kept.push(bytes.subarray(at, end));
    at = end;
  }
  kept.push(bytes.subarray(at));
  return Buffer.concat(kept);
}

const KEPT_PNG_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

function stripPng(bytes: Buffer): Buffer {
  const kept: Buffer[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const end = at + 12 + bytes.readUInt32BE(at);
    if (KEPT_PNG_CHUNKS.has(bytes.toString("latin1", at + 4, at + 8))) kept.push(bytes.subarray(at, end));
    at = end;
  }
  return Buffer.concat(kept);
}

/** The same pixels without EXIF, XMP, comments or text chunks. */
export function stripMetadata(bytes: Buffer, kind: PhotoKind): Buffer {
  return kind === "jpeg" ? stripJpeg(bytes) : stripPng(bytes);
}

export const photoContentType = (kind: PhotoKind): string => (kind === "jpeg" ? "image/jpeg" : "image/png");

/** The `photo` part of a multipart/form-data body. */
export function multipartPhoto(body: Buffer, contentType: string): Buffer | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return null;
  const delimiter = Buffer.from(`--${marker}`);
  let at = body.indexOf(delimiter);
  while (at >= 0) {
    const headerStart = at + delimiter.length + 2;
    const headerEnd = body.indexOf("\r\n\r\n", headerStart);
    if (headerEnd < 0) return null;
    const headers = body.toString("latin1", headerStart, headerEnd);
    const next = body.indexOf(Buffer.concat([Buffer.from("\r\n"), delimiter]), headerEnd + 4);
    if (next < 0) return null;
    if (/name="photo"/i.test(headers)) return body.subarray(headerEnd + 4, next);
    at = next + 2;
  }
  return null;
}
