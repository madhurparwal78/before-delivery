// Licence certificates: the type judged by the leading bytes, and location data removed with orientation kept.
import { crc32 } from "node:zlib";

type ImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffImage(data: Buffer): ImageType | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** The orientation of a TIFF (EXIF) block, or null. */
function orientation(tiff: Buffer): number | null {
  if (tiff.length < 8) return null;
  const little = tiff.subarray(0, 2).toString("latin1") === "II";
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

/** A TIFF block holding only the orientation tag (so every GPS field is gone), or null when there is none. */
function orientationOnly(tiff: Buffer): Buffer | null {
  const value = orientation(tiff);
  if (value === null) return null;
  const out = Buffer.alloc(8 + 2 + 12 + 4);
  out.write("MM", 0, "latin1");
  out.writeUInt16BE(42, 2);
  out.writeUInt32BE(8, 4);
  out.writeUInt16BE(1, 8);
  out.writeUInt16BE(0x0112, 10);
  out.writeUInt16BE(3, 12);
  out.writeUInt32BE(1, 14);
  out.writeUInt16BE(value, 18);
  out.writeUInt32BE(0, 22);
  return out;
}

const EXIF_PREFIX = Buffer.from("Exif\0\0", "latin1");
const XMP_PREFIX = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");

function stripJpeg(data: Buffer): Buffer {
  const out: Buffer[] = [data.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= data.length && data[at] === 0xff) {
    const marker = data[at + 1];
    if (marker === 0xda) break;
    const length = data.readUInt16BE(at + 2);
    const segment = data.subarray(at, at + 2 + length);
    const payload = segment.subarray(4);
    if (marker === 0xe1 && payload.subarray(0, 6).equals(EXIF_PREFIX)) {
      const kept = orientationOnly(payload.subarray(6));
      if (kept) {
        const header = Buffer.alloc(4);
        header.writeUInt16BE(0xffe1, 0);
        header.writeUInt16BE(2 + EXIF_PREFIX.length + kept.length, 2);
        out.push(header, EXIF_PREFIX, kept);
      }
    } else if (!(marker === 0xe1 && payload.subarray(0, XMP_PREFIX.length).equals(XMP_PREFIX))) {
      out.push(segment);
    }
    at += 2 + length;
  }
  out.push(data.subarray(at));
  return Buffer.concat(out);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function stripPng(data: Buffer): Buffer {
  const out: Buffer[] = [data.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= data.length) {
    const length = data.readUInt32BE(at);
    const type = data.subarray(at + 4, at + 8).toString("latin1");
    const chunk = data.subarray(at, at + 12 + length);
    const body = chunk.subarray(8, 8 + length);
    const xmp = (type === "iTXt" || type === "tEXt" || type === "zTXt") && body.subarray(0, 17).toString("latin1") === "XML:com.adobe.xmp";
    if (type === "eXIf") {
      const kept = orientationOnly(body.subarray(0, 6).equals(EXIF_PREFIX) ? body.subarray(6) : body);
      if (kept) out.push(pngChunk("eXIf", kept));
    } else if (!xmp) {
      out.push(chunk);
    }
    at += 12 + length;
  }
  return Buffer.concat(out);
}

function stripWebp(data: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let at = 12;
  let hasExif = false;
  while (at + 8 <= data.length) {
    const type = data.subarray(at, at + 4).toString("latin1");
    const size = data.readUInt32LE(at + 4);
    const body = data.subarray(at + 8, at + 8 + size);
    const padded = size + (size % 2);
    if (type === "EXIF") {
      const kept = orientationOnly(body.subarray(0, 6).equals(EXIF_PREFIX) ? body.subarray(6) : body);
      if (kept) {
        const head = Buffer.alloc(8);
        head.write("EXIF", 0, "latin1");
        head.writeUInt32LE(kept.length, 4);
        chunks.push(head, kept, Buffer.alloc(kept.length % 2));
        hasExif = true;
      }
    } else if (type !== "XMP ") {
      chunks.push(Buffer.from(data.subarray(at, at + 8 + padded)));
    }
    at += 8 + padded;
  }
  const body = Buffer.concat(chunks);
  if (body.subarray(0, 4).toString("latin1") === "VP8X") body[8] = (body[8] & ~0x0c) | (hasExif ? 0x08 : 0);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(body.length + 4, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

/** The certificate as stored: every location field removed, orientation and pixels kept. */
export function withoutLocation(type: ImageType, data: Buffer): Buffer {
  if (type === "image/jpeg") return stripJpeg(data);
  if (type === "image/png") return stripPng(data);
  return stripWebp(data);
}
