import { inflateSync } from "node:zlib";

export type PhotoType = "jpeg" | "png";

export interface PhotoHeader {
  type: PhotoType;
  /** Orientation tag 1 to 8; 1 when there is none. */
  orientation: number;
  /** Stored pixel dimensions, before the orientation tag is applied. */
  storedWidth: number;
  storedHeight: number;
  /** Dimensions of the upright image. */
  width: number;
  height: number;
  displayP3: boolean;
}

export const MAX_PHOTO_BYTES = 15_000_000;
const MAX_PIXELS = 40_000_000;
const MAX_SIDE = 12_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** Decides JPEG or PNG from the first bytes alone. */
function sniffType(bytes: Buffer): PhotoType | null {
  if (bytes.subarray(0, 3).equals(JPEG_SIGNATURE)) return "jpeg";
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  return null;
}

export function exceedsPixelLimit({ width, height }: Pick<PhotoHeader, "width" | "height">): boolean {
  return width * height > MAX_PIXELS || width > MAX_SIDE || height > MAX_SIDE;
}

/** Orientation from a TIFF block (the content of an EXIF segment after "Exif\0\0"). */
function tiffOrientation(tiff: Buffer): number {
  if (tiff.length < 8) return 1;
  const little = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const directory = u32(4);
  if (directory + 2 > tiff.length) return 1;
  const entries = u16(directory);
  for (let index = 0; index < entries; index += 1) {
    const at = directory + 2 + index * 12;
    if (at + 12 > tiff.length) return 1;
    if (u16(at) === 0x0112) {
      const value = u16(at + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** The description text of an ICC profile, which is how a Display P3 profile names itself. */
function iccDescribesDisplayP3(profile: Buffer): boolean {
  if (profile.length < 132) return false;
  const tags = profile.readUInt32BE(128);
  for (let index = 0; index < tags; index += 1) {
    const at = 132 + index * 12;
    if (at + 12 > profile.length) return false;
    if (profile.toString("latin1", at, at + 4) !== "desc") continue;
    const offset = profile.readUInt32BE(at + 4);
    const size = profile.readUInt32BE(at + 8);
    const body = profile.subarray(offset, offset + size);
    const kind = body.toString("latin1", 0, 4);
    if (kind === "desc") return body.toString("latin1", 12, 12 + body.readUInt32BE(8)).includes("Display P3");
    if (kind === "mluc") {
      const length = body.readUInt32BE(20);
      const start = body.readUInt32BE(24);
      return body.subarray(start, start + length).swap16().toString("utf16le").includes("Display P3");
    }
  }
  return false;
}

interface Segments {
  width: number;
  height: number;
  orientation: number;
  profile: Buffer | null;
}

function readJpeg(bytes: Buffer): Segments | null {
  let orientation = 1;
  const profileParts = new Map<number, Buffer>();
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    const body = bytes.subarray(at + 4, at + 2 + length);
    if (marker === 0xe1 && body.toString("latin1", 0, 6) === "Exif\0\0") orientation = tiffOrientation(body.subarray(6));
    if (marker === 0xe2 && body.toString("latin1", 0, 12) === "ICC_PROFILE\0") profileParts.set(body[12] ?? 0, body.subarray(14));
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrameHeader) {
      if (body.length < 5) return null;
      const profile = profileParts.size > 0 ? Buffer.concat([...profileParts.entries()].sort(([a], [b]) => a - b).map(([, part]) => part)) : null;
      return { height: body.readUInt16BE(1), width: body.readUInt16BE(3), orientation, profile };
    }
    at += 2 + length;
  }
  return null;
}

function readPng(bytes: Buffer): Segments | null {
  let width = 0;
  let height = 0;
  let orientation = 1;
  let profile: Buffer | null = null;
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (at === 8 && (kind !== "IHDR" || length !== 13)) return null;
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
    }
    if (kind === "eXIf") orientation = tiffOrientation(body);
    if (kind === "iCCP") {
      const nameEnd = body.indexOf(0);
      if (nameEnd >= 0) profile = inflateSync(body.subarray(nameEnd + 2), { finishFlush: 2 });
    }
    if (kind === "IEND") break;
    at += 12 + length;
  }
  return width > 0 && height > 0 ? { width, height, orientation, profile } : null;
}

/** Type, dimensions, orientation and colour profile from the header segments alone; no pixel is decoded. */
export function readHeader(bytes: Buffer): PhotoHeader | null {
  const type = sniffType(bytes);
  if (!type) return null;
  let segments: Segments | null = null;
  try {
    segments = type === "jpeg" ? readJpeg(bytes) : readPng(bytes);
  } catch {
    return null;
  }
  if (!segments || segments.width === 0 || segments.height === 0) return null;
  const swapped = segments.orientation >= 5;
  return {
    type,
    orientation: segments.orientation,
    storedWidth: segments.width,
    storedHeight: segments.height,
    width: swapped ? segments.height : segments.width,
    height: swapped ? segments.width : segments.height,
    displayP3: segments.profile !== null && iccDescribesDisplayP3(segments.profile),
  };
}
