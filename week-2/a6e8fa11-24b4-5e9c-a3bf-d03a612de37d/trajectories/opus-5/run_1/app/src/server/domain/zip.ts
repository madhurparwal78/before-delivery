import { deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function looksLikeZip(data: Buffer): boolean {
  return data.length > 4 && data.readUInt32LE(0) === LOCAL_SIGNATURE;
}

/** Reads only the central directory, so archive checks never expand entry data. */
export function readCentralDirectory(data: Buffer): ZipEntry[] | null {
  let eocd = -1;
  const earliest = Math.max(0, data.length - 65557);
  for (let at = data.length - 22; at >= earliest; at--) {
    if (data.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = data.readUInt16LE(eocd + 10);
  let at = data.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== CENTRAL_SIGNATURE) return null;
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    entries.push({
      name: data.slice(at + 46, at + 46 + nameLength).toString('utf8'),
      method: data.readUInt16LE(at + 10),
      compressedSize: data.readUInt32LE(at + 20),
      uncompressedSize: data.readUInt32LE(at + 24),
      localOffset: data.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readZipEntry(data: Buffer, entry: ZipEntry): Buffer | null {
  const at = entry.localOffset;
  if (at + 30 > data.length || data.readUInt32LE(at) !== LOCAL_SIGNATURE) return null;
  const nameLength = data.readUInt16LE(at + 26);
  const extraLength = data.readUInt16LE(at + 28);
  const start = at + 30 + nameLength + extraLength;
  const slice = data.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return slice;
  if (entry.method !== 8) return null;
  try {
    return inflateRawSync(slice);
  } catch {
    return null;
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string;
  data: Buffer;
}

export function writeZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const compressed = deflateRawSync(file.data, { level: 6 });
    const crc = crc32(file.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + compressed.length;
  }
  const centralBlock = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBlock, eocd]);
}
