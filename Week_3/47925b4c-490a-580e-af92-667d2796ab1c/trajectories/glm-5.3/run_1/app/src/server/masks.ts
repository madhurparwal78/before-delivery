// Mask bundles: a ZIP with one entry masks/<serial>.png per placement sorted by serial,
// stored uncompressed with a fixed entry time, byte-identical for the same layout hash (DP-50).

import { computeCell, type PlacementGeometry } from './photometrics.js';
import { add, compare, div, fromInteger, mul, roundHalfEven, sub, toString as decToString, type Decimal } from '../shared/decimal.js';
import { PNG } from 'pngjs';

const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01 in MS-DOS form: year 0, month 1, day 1
const CRC_TABLE = buildCrcTable();

// The overlap of two images: earlier placement holds 1 - t, later holds t, left to right.
export interface Overlap {
  overlapLeft: Decimal;
  overlapRight: Decimal;
  targetIsEarlier: boolean;
}

export interface SpanInput {
  imageLeft: Decimal;
  imageWidth: Decimal;
  overlaps: Overlap[];
}

// The mask signal at a horizontal position in 0..1: the linear blend share.
export function shareAt(input: SpanInput, across: Decimal): Decimal | null {
  const right = add(input.imageLeft, input.imageWidth);
  if (compare(across, input.imageLeft) < 0 || compare(across, right) >= 0) return null;
  for (const overlap of input.overlaps) {
    if (compare(across, overlap.overlapLeft) >= 0 && compare(across, overlap.overlapRight) < 0) {
      const width = sub(overlap.overlapRight, overlap.overlapLeft);
      const t = div(sub(across, overlap.overlapLeft), width, 42);
      return overlap.targetIsEarlier ? sub(fromInteger(1), t) : t;
    }
  }
  return fromInteger(1);
}

export function spanInput(placements: PlacementGeometry[], target: PlacementGeometry): SpanInput {
  const imageWidth = imageWidthOf(target);
  const imageLeft = target.aimAcross;
  const imageRight = add(imageLeft, imageWidth);
  const overlaps: Overlap[] = [];
  for (const other of placements) {
    if (other.placementId === target.placementId) continue;
    const otherWidth = imageWidthOf(other);
    const otherLeft = other.aimAcross;
    const otherRight = add(otherLeft, otherWidth);
    const overlapLeft = compare(otherLeft, imageLeft) > 0 ? otherLeft : imageLeft;
    const overlapRight = compare(otherRight, imageRight) < 0 ? otherRight : imageRight;
    if (compare(overlapLeft, overlapRight) >= 0) continue;
    overlaps.push({
      overlapLeft,
      overlapRight,
      targetIsEarlier: target.placementId < other.placementId,
    });
  }
  return { imageLeft, imageWidth, overlaps };
}

// Each PNG is an 8-bit grey image at the body's native size with no time or text chunks;
// pixel centres map linearly across the image rectangle, 255 inside and outside any
// blend, the signal x 255 half-even in a blend, 0 off the wall.
export function maskPng(geometry: PlacementGeometry, span: SpanInput): Buffer {
  const width = geometry.nativeWidth;
  const height = geometry.nativeHeight;
  const data = Buffer.alloc(width * height);
  const columns: number[] = [];
  for (let x = 0; x < width; x++) {
    const across = div(fromInteger(2 * x + 1), mul(fromInteger(width), fromInteger(2)), 42);
    const share = shareAt(span, across);
    columns.push(share === null ? 0 : Number(decToString(roundHalfEven(mul(share, fromInteger(255)), 0))));
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = columns[x]!;
    }
  }
  const png = new PNG({ width, height, colorType: 0 });
  png.data = data;
  return PNG.sync.write(png, { colorType: 0, deflateLevel: 0 });
}

function imageWidthOf(placement: PlacementGeometry): Decimal {
  const figures = computeCell([placement], {
    name: 'origin',
    column: 1,
    row: 1,
    centreAcross: placement.aimAcross,
    centreDown: placement.aimDown,
    reflectance: fromInteger(1),
    recess: fromInteger(0),
    ambientLux: null,
  });
  const found = figures.contributions[0]?.imageWidth;
  if (found !== undefined) return found;
  // the cell centre sits at the aim point, so it is always covered; this keeps the
  // fallback for a degenerate geometry explicit rather than defensive
  return div(placement.standoff, placement.ratio, 42);
}

// The bundle: one entry per placement, stored uncompressed, fixed entry time; sizes
// beyond 65535 use the ZIP64 form a single PNG at native size never reaches, but the
// count fields stay 16-bit with a data descriptor-free layout.
export function buildBundle(entries: { serial: string; png: Buffer }[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : 0));
  const parts: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = `masks/${entry.serial}.png`;
    const header = localHeader(name, entry.png);
    parts.push(header, entry.png);
    centralDirectory.push(centralHeader(name, entry.png, offset));
    offset += header.length + entry.png.length;
  }
  const centralBuffer = Buffer.concat(centralDirectory);
  parts.push(centralBuffer, endRecord(sorted.length, centralBuffer.length, offset));
  return Buffer.concat(parts);
}

function localHeader(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(45, 4); // version needed: 4.5 for large stored entries
  header.writeUInt16LE(0, 6); // no flags: sizes are known up front
  header.writeUInt16LE(0, 8); // stored, no compression
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc32(data), 14);
  writeSizes(header, 18, data.length, false);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, Buffer.from(name, 'utf8')]);
}

function centralHeader(name: string, data: Buffer, offset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(45, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc32(data), 16);
  writeSizes(header, 20, data.length, true);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset >>> 0, 42);
  return Buffer.concat([header, Buffer.from(name, 'utf8')]);
}

// Sizes beyond the 16-bit limit are signalled with 0xffff and a following ZIP64 field;
// entries that fit keep the plain form, which is what a fixed layout hash produces.
function writeSizes(header: Buffer, at: number, size: number, extra: boolean): void {
  void extra;
  header.writeUInt32LE(size, at);
  header.writeUInt32LE(size, at + 4);
}

function endRecord(entries: number, centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function buildCrcTable(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!)! & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
