// Photo bytes: type from magic bytes, upright dimensions from the image header,
// before any pixel is decoded (Business rules).
//
// JPEG: the frame header (SOFn) gives the stored dimensions; PNG: the IHDR chunk.
// Orientation tag 5..8 swaps width and height.

export interface PhotoHeader {
  kind: "jpeg" | "png";
  width: number;   // upright pixels
  height: number;  // upright pixels
  orientation: number; // 1..8
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function sniffPhotoType(buf: Buffer): "jpeg" | "png" | null {
  if (buf.length >= 3 && JPEG_MAGIC.every((b, i) => buf[i] === b)) return "jpeg";
  if (buf.length >= 8 && PNG_MAGIC.every((b, i) => buf[i] === b)) return "png";
  return null;
}

function isExifLittleEndian(buf: Buffer, tiff: number): boolean {
  return buf.readUInt16BE(tiff) === 0x4949;
}

function readExifValue(buf: Buffer, tiff: number, le: boolean, entry: number): number | null {
  // entry is the offset of a 12-byte IFD entry
  const type = le ? buf.readUInt16LE(entry + 2) : buf.readUInt16BE(entry + 2);
  const count = le ? buf.readUInt32LE(entry + 4) : buf.readUInt32BE(entry + 4);
  if (type !== 3 || count !== 1) return null;
  return le ? buf.readUInt16LE(entry + 8) : buf.readUInt16BE(entry + 8);
}

function jpegOrientation(buf: Buffer, tiff: number): number {
  const le = isExifLittleEndian(buf, tiff);
  const ifd0 = le ? buf.readUInt32LE(tiff + 4) : buf.readUInt32BE(tiff + 4);
  const base = tiff + ifd0;
  if (base + 2 > buf.length) return 1;
  const n = le ? buf.readUInt16LE(base) : buf.readUInt16BE(base);
  for (let i = 0; i < n; i++) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > buf.length) return 1;
    const tag = le ? buf.readUInt16LE(entry) : buf.readUInt16BE(entry);
    if (tag === 0x0112) return readExifValue(buf, tiff, le, entry) ?? 1;
  }
  return 1;
}

function findExifTiff(buf: Buffer, segment: number, len: number): number | null {
  // APP1 payload begins with "Exif\0\0"; the TIFF header follows.
  if (buf.length >= segment + 6 && buf.toString("latin1", segment, segment + 6) === "Exif\0\0") {
    return segment + 6;
  }
  return null;
}

function jpegSof(buf: Buffer): { width: number; height: number; orientation: number } | null {
  let i = 2;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xda) break; // start of scan
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), orientation: 1 };
    }
    if (marker === 0xe1) {
      const tiff = findExifTiff(buf, i + 4, len - 2);
      // orientation read below after SOF found
      const sof = jpegSofTail(buf, i + 2 + len);
      if (sof && tiff !== null) sof.orientation = jpegOrientation(buf, tiff);
      if (sof) return sof;
    }
    i += 2 + len;
  }
  return null;
}

function jpegSofTail(buf: Buffer, from: number): { width: number; height: number; orientation: number } | null {
  let i = from;
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xda) break;
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), orientation: 1 };
    }
    i += 2 + len;
  }
  return null;
}

function pngHeader(buf: Buffer): PhotoHeader | null {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { kind: "png", width, height, orientation: 1 };
}

export function readPhotoHeader(buf: Buffer): PhotoHeader | null {
  const kind = sniffPhotoType(buf);
  if (kind === null) return null;
  if (kind === "png") return pngHeader(buf);
  const sof = jpegSof(buf);
  if (!sof) return null;
  const upright = sof.orientation >= 5;
  return {
    kind: "jpeg",
    width: upright ? sof.height : sof.width,
    height: upright ? sof.width : sof.height,
    orientation: sof.orientation,
  };
}

export const PIXEL_LIMIT = 40_000_000;
export const SIDE_LIMIT = 12_000;

export function overPixelLimit(width: number, height: number): boolean {
  return width * height > PIXEL_LIMIT || width > SIDE_LIMIT || height > SIDE_LIMIT;
}

export function sha256Hex(buf: Buffer): string {
  // Node crypto is used at the call site; kept here for the type contract.
  throw new Error("use node:crypto");
}
