import { crc32 } from './crc32';

/**
 * Licence certificate handling: the type is judged by the leading bytes, and
 * location data is removed from the embedded metadata while the orientation
 * tag and the pixels are kept.
 */

export type CertificateContentType = 'image/png' | 'image/jpeg' | 'image/webp';

const GPS_IFD_POINTER = 0x8825;
const EXIF_IFD_POINTER = 0x8769;
const INTEROP_IFD_POINTER = 0xa005;
const THUMBNAIL_OFFSET = 0x0201;
const THUMBNAIL_LENGTH = 0x0202;

export function detectContentType(bytes: Buffer): CertificateContentType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
};

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Values longer than four bytes, otherwise the inline four bytes. */
  data: Buffer;
  sub: TiffNode | null;
  dataOffset: number;
}

interface TiffNode {
  entries: Entry[];
  next: TiffNode | null;
  thumbnail: Buffer | null;
  start: number;
  thumbnailOffset: number;
}

function readNumber(buffer: Buffer, offset: number, size: number, littleEndian: boolean): number {
  if (size === 2) return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function writeNumber(
  buffer: Buffer,
  value: number,
  offset: number,
  size: number,
  littleEndian: boolean,
): void {
  if (size === 2) {
    if (littleEndian) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt16BE(value, offset);
    return;
  }
  if (littleEndian) buffer.writeUInt32LE(value, offset);
  else buffer.writeUInt32BE(value, offset);
}

function parseNode(tiff: Buffer, offset: number, littleEndian: boolean, depth: number): TiffNode | null {
  if (depth > 4 || offset + 2 > tiff.length) return null;
  const count = readNumber(tiff, offset, 2, littleEndian);
  if (offset + 2 + count * 12 + 4 > tiff.length) return null;
  const entries: Entry[] = [];
  let thumbnailOffsetValue = -1;
  let thumbnailLengthValue = -1;
  for (let index = 0; index < count; index += 1) {
    const at = offset + 2 + index * 12;
    const tag = readNumber(tiff, at, 2, littleEndian);
    const type = readNumber(tiff, at + 2, 2, littleEndian);
    const valueCount = readNumber(tiff, at + 4, 4, littleEndian);
    const unit = TYPE_SIZES[type];
    if (unit === undefined) continue;
    const length = unit * valueCount;
    let data: Buffer;
    if (length <= 4) {
      data = Buffer.from(tiff.subarray(at + 8, at + 12));
    } else {
      const dataAt = readNumber(tiff, at + 8, 4, littleEndian);
      if (dataAt + length > tiff.length) continue;
      data = Buffer.from(tiff.subarray(dataAt, dataAt + length));
    }
    if (tag === GPS_IFD_POINTER) continue;
    let sub: TiffNode | null = null;
    if (tag === EXIF_IFD_POINTER || tag === INTEROP_IFD_POINTER) {
      sub = parseNode(tiff, readNumber(tiff, at + 8, 4, littleEndian), littleEndian, depth + 1);
      if (sub === null) continue;
    }
    if (tag === THUMBNAIL_OFFSET) thumbnailOffsetValue = readNumber(tiff, at + 8, 4, littleEndian);
    if (tag === THUMBNAIL_LENGTH) thumbnailLengthValue = readNumber(tiff, at + 8, 4, littleEndian);
    entries.push({ tag, type, count: valueCount, data, sub, dataOffset: 0 });
  }
  const nextOffset = readNumber(tiff, offset + 2 + count * 12, 4, littleEndian);
  const next = nextOffset > 0 && nextOffset !== offset ? parseNode(tiff, nextOffset, littleEndian, depth + 1) : null;
  let thumbnail: Buffer | null = null;
  if (
    thumbnailOffsetValue >= 0 &&
    thumbnailLengthValue > 0 &&
    thumbnailOffsetValue + thumbnailLengthValue <= tiff.length
  ) {
    thumbnail = Buffer.from(
      tiff.subarray(thumbnailOffsetValue, thumbnailOffsetValue + thumbnailLengthValue),
    );
  }
  return { entries, next, thumbnail, start: 0, thumbnailOffset: 0 };
}

function assignOffsets(node: TiffNode, cursor: number): number {
  node.start = cursor;
  let at = cursor + 2 + node.entries.length * 12 + 4;
  for (const entry of node.entries) {
    if (entry.sub !== null) continue;
    if (entry.data.length > 4) {
      entry.dataOffset = at;
      at += entry.data.length + (entry.data.length % 2);
    }
  }
  for (const entry of node.entries) {
    if (entry.sub !== null) at = assignOffsets(entry.sub, at);
  }
  if (node.thumbnail !== null) {
    node.thumbnailOffset = at;
    at += node.thumbnail.length;
  }
  if (node.next !== null) at = assignOffsets(node.next, at);
  return at;
}

function writeNode(out: Buffer, node: TiffNode, littleEndian: boolean): void {
  writeNumber(out, node.entries.length, node.start, 2, littleEndian);
  node.entries.forEach((entry, index) => {
    const at = node.start + 2 + index * 12;
    writeNumber(out, entry.tag, at, 2, littleEndian);
    writeNumber(out, entry.type, at + 2, 2, littleEndian);
    writeNumber(out, entry.count, at + 4, 4, littleEndian);
    if (entry.sub !== null) {
      writeNumber(out, entry.sub.start, at + 8, 4, littleEndian);
      return;
    }
    if (entry.tag === THUMBNAIL_OFFSET && node.thumbnail !== null) {
      writeNumber(out, node.thumbnailOffset, at + 8, 4, littleEndian);
      return;
    }
    if (entry.data.length > 4) {
      writeNumber(out, entry.dataOffset, at + 8, 4, littleEndian);
      entry.data.copy(out, entry.dataOffset);
      return;
    }
    entry.data.copy(out, at + 8);
  });
  writeNumber(out, node.next === null ? 0 : node.next.start, node.start + 2 + node.entries.length * 12, 4, littleEndian);
  for (const entry of node.entries) {
    if (entry.sub !== null) writeNode(out, entry.sub, littleEndian);
  }
  if (node.thumbnail !== null) node.thumbnail.copy(out, node.thumbnailOffset);
  if (node.next !== null) writeNode(out, node.next, littleEndian);
}

/** Rebuilds a TIFF metadata block without its GPS IFD. */
function stripTiffGps(tiff: Buffer): Buffer | null {
  if (tiff.length < 8) return null;
  const marker = tiff.toString('latin1', 0, 2);
  if (marker !== 'II' && marker !== 'MM') return null;
  const littleEndian = marker === 'II';
  if (readNumber(tiff, 2, 2, littleEndian) !== 0x002a) return null;
  const root = parseNode(tiff, readNumber(tiff, 4, 4, littleEndian), littleEndian, 0);
  if (root === null) return null;
  const total = assignOffsets(root, 8);
  const out = Buffer.alloc(total);
  out.write(marker, 0, 'latin1');
  writeNumber(out, 0x002a, 2, 2, littleEndian);
  writeNumber(out, root.start, 4, 4, littleEndian);
  writeNode(out, root, littleEndian);
  return out;
}

const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/\0';

function stripJpeg(bytes: Buffer): Buffer {
  const parts: Buffer[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    if (marker === 0xd9 || marker === 0xda) {
      parts.push(bytes.subarray(at));
      return Buffer.concat(parts);
    }
    const length = bytes.readUInt16BE(at + 2);
    const segment = bytes.subarray(at, at + 2 + length);
    const payload = segment.subarray(4);
    if (marker === 0xe1 && payload.toString('latin1', 0, 6) === 'Exif\0\0') {
      const rebuilt = stripTiffGps(payload.subarray(6));
      if (rebuilt !== null) {
        const header = Buffer.alloc(4);
        header.writeUInt16BE(0xffe1, 0);
        header.writeUInt16BE(rebuilt.length + 8, 2);
        parts.push(header, Buffer.from('Exif\0\0', 'latin1'), rebuilt);
      }
    } else if (marker === 0xe1 && payload.toString('latin1', 0, XMP_NAMESPACE.length) === XMP_NAMESPACE) {
      // An XMP packet can carry location data and is dropped whole.
    } else {
      parts.push(segment);
    }
    at += 2 + length;
  }
  parts.push(bytes.subarray(at));
  return Buffer.concat(parts);
}

function stripPng(bytes: Buffer): Buffer {
  const parts: Buffer[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const payload = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'eXIf') {
      const rebuilt = stripTiffGps(payload);
      if (rebuilt !== null) parts.push(pngChunk('eXIf', rebuilt));
    } else if (
      (type === 'iTXt' || type === 'tEXt' || type === 'zTXt') &&
      payload.toString('latin1', 0, 17) === 'XML:com.adobe.xmp'
    ) {
      // An XMP packet can carry location data and is dropped whole.
    } else {
      parts.push(bytes.subarray(at, at + 12 + length));
    }
    at += 12 + length;
  }
  return Buffer.concat(parts);
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const out = Buffer.alloc(12 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  out.write(type, 4, 'latin1');
  payload.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + payload.length)), 8 + payload.length);
  return out;
}

function stripWebp(bytes: Buffer): Buffer {
  const parts: Buffer[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const type = bytes.toString('latin1', at, at + 4);
    const length = bytes.readUInt32LE(at + 4);
    const padded = length + (length % 2);
    const payload = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'EXIF') {
      const rebuilt = stripTiffGps(payload);
      if (rebuilt !== null) parts.push(riffChunk('EXIF', rebuilt));
    } else if (type === 'XMP ') {
      // An XMP packet can carry location data and is dropped whole.
    } else {
      parts.push(bytes.subarray(at, at + 8 + padded));
    }
    at += 8 + padded;
  }
  const body = Buffer.concat(parts);
  const out = Buffer.alloc(12 + body.length);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(4 + body.length, 4);
  out.write('WEBP', 8, 'latin1');
  body.copy(out, 12);
  return out;
}

function riffChunk(type: string, payload: Buffer): Buffer {
  const padded = payload.length + (payload.length % 2);
  const out = Buffer.alloc(8 + padded);
  out.write(type, 0, 'latin1');
  out.writeUInt32LE(payload.length, 4);
  payload.copy(out, 8);
  return out;
}

export function removeLocationData(bytes: Buffer, contentType: CertificateContentType): Buffer {
  if (contentType === 'image/jpeg') return stripJpeg(bytes);
  if (contentType === 'image/png') return stripPng(bytes);
  return stripWebp(bytes);
}
