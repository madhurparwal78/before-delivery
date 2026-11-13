import { createHash } from "node:crypto";
import { NIGHT_NUMBER } from "./constants";

export type SheetContentType = "image/png" | "image/jpeg";

export interface SheetCheck {
  readonly contentType: SheetContentType | null;
  readonly ok: boolean;
  readonly width: number | null;
  readonly height: number | null;
}

export interface SheetStoreResult {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
  readonly contentType: SheetContentType;
  readonly width: number;
  readonly height: number;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function extensionFor(contentType: SheetContentType): string {
  return contentType === "image/png" ? "png" : "jpg";
}

export function sheetKey(round: number, sha256: string, ext: string): string {
  return `sheets/night-${NIGHT_NUMBER}/round-${round}/${sha256}.${ext}`;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const JPEG_SIGNATURE = [255, 216, 255];

/**
 * The one sheet content and dimension check. The file name is never consulted:
 * the declared type is checked against the bytes themselves and the width and
 * height are read from the image.
 */
export function checkSheetBytes(declared: SheetContentType, bytes: Uint8Array): SheetCheck {
  if (declared === "image/png") {
    if (bytes.length < 8) return { contentType: null, ok: false, width: null, height: null };
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) return { contentType: null, ok: false, width: null, height: null };
    }
    const dims = pngDimensions(bytes);
    if (dims === null) return { contentType: declared, ok: false, width: null, height: null };
    return { contentType: declared, ok: true, width: dims.width, height: dims.height };
  }
  if (bytes.length < 3) return { contentType: null, ok: false, width: null, height: null };
  for (let i = 0; i < 3; i++) {
    if (bytes[i] !== JPEG_SIGNATURE[i]) return { contentType: null, ok: false, width: null, height: null };
  }
  const dims = jpegDimensions(bytes);
  if (dims === null) return { contentType: declared, ok: false, width: null, height: null };
  return { contentType: declared, ok: true, width: dims.width, height: dims.height };
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    return null;
  }
  const width = ((bytes[16] ?? 0) << 24) | ((bytes[17] ?? 0) << 16) | ((bytes[18] ?? 0) << 8) | (bytes[19] ?? 0);
  const height = ((bytes[20] ?? 0) << 24) | ((bytes[21] ?? 0) << 16) | ((bytes[22] ?? 0) << 8) | (bytes[23] ?? 0);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (offset + 9 >= bytes.length) return null;
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    if (marker === 0xda) return null;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export const SHEET_MAX_BYTES = 5_000_000;
export const SHEET_MIN_DIMENSION = 200;
export const SHEET_MAX_DIMENSION = 4000;

export function dimensionsInRange(width: number, height: number): boolean {
  return (
    width >= SHEET_MIN_DIMENSION &&
    width <= SHEET_MAX_DIMENSION &&
    height >= SHEET_MIN_DIMENSION &&
    height <= SHEET_MAX_DIMENSION
  );
}
