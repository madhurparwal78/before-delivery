/** The one place the sheet content and dimension checks are decided. */

export const SHEET_MAX_BYTES = 5_000_000;
const SHEET_MIN_SIDE = 200;
const SHEET_MAX_SIDE = 4000;

export type SheetType = 'image/png' | 'image/jpeg';

export function sheetType(declared: string): SheetType | null {
  const type = declared.split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'image/png') return 'image/png';
  if (type === 'image/jpeg') return 'image/jpeg';
  return null;
}

export function sheetExtension(type: SheetType): 'png' | 'jpg' {
  return type === 'image/png' ? 'png' : 'jpg';
}

export type SheetVerdict =
  | { verdict: 'ok'; width: number; height: number }
  /** No bytes at all. */
  | { verdict: 'empty' }
  /** The bytes do not match the declared type. */
  | { verdict: 'content' }
  /** Unreadable or out-of-range dimensions. */
  | { verdict: 'dimensions' };

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  if (bytes.subarray(8 + 4, 8 + 8).toString('latin1') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < bytes.byteLength) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const segmentLength = bytes.readUInt16BE(at + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    if (segmentLength < 2) return null;
    at += 2 + segmentLength;
  }
  return null;
}

/** Check the bytes against the declared type, then the pixel dimensions. */
export function inspectSheet(bytes: Buffer, declared: SheetType): SheetVerdict {
  if (bytes.byteLength === 0) return { verdict: 'empty' };
  if (declared === 'image/png') {
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return { verdict: 'content' };
    const size = pngSize(bytes);
    if (size === null) return { verdict: 'dimensions' };
    return withinRange(size);
  }
  if (bytes.byteLength < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { verdict: 'content' };
  }
  const size = jpegSize(bytes);
  if (size === null) return { verdict: 'dimensions' };
  return withinRange(size);
}

function withinRange(size: { width: number; height: number }): SheetVerdict {
  const inRange = (side: number): boolean => side >= SHEET_MIN_SIDE && side <= SHEET_MAX_SIDE;
  if (!inRange(size.width) || !inRange(size.height)) return { verdict: 'dimensions' };
  return { verdict: 'ok', width: size.width, height: size.height };
}
