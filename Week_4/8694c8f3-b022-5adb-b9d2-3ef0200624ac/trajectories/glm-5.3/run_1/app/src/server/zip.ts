import { createHash } from 'node:crypto';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function crc32 (bytes: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

interface LocalHeader {
  name: string;
  crc: number;
  size: number;
  offset: number;
}

// Minimal store-method ZIP writer. Deflate is not needed: entries are stored
// uncompressed, which every unzip tool reads and Node's own reader accepts.
export function buildZip (entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const headers: LocalHeader[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(entry.data.byteLength, 18);
    header.writeUInt32LE(entry.data.byteLength, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    chunks.push(header, nameBytes, entry.data);
    headers.push({ name: entry.name, crc, size: entry.data.byteLength, offset });
    offset += header.length + nameBytes.length + entry.data.byteLength;
  }
  const centralStart = offset;
  for (const h of headers) {
    const nameBytes = Buffer.from(h.name, 'utf8');
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0, 14);
    record.writeUInt32LE(h.crc, 16);
    record.writeUInt32LE(h.size, 20);
    record.writeUInt32LE(h.size, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(0, 36);
    record.writeUInt32LE(0, 38);
    record.writeUInt32LE(h.offset, 42);
    chunks.push(record, nameBytes);
    offset += record.length + nameBytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(headers.length, 8);
  end.writeUInt16LE(headers.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);
  return Buffer.concat(chunks);
}

export interface ParsedZip {
  entries: Map<string, Buffer>;
}

export function parseZip (bytes: Buffer): ParsedZip | null {
  const endOffset = findEndRecord(bytes);
  if (endOffset === -1) return null;
  const count = bytes.readUInt16LE(endOffset + 10);
  let offset = bytes.readUInt32LE(endOffset + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (method !== 0) return null;
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (crc32(data) !== crc) return null;
    entries.set(name, Buffer.from(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries };
}

function findEndRecord (bytes: Buffer): number {
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
