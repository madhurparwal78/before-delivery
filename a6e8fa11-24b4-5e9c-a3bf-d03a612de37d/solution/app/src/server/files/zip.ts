// Zip archives: the central directory is read without touching any entry's content, so the archive
// checks run before anything is inflated; entries are inflated with a hard output cap.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export class ZipFormatError extends Error {}

export const LOCAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Lists the central directory. */
export function centralDirectory(data: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("no end of central directory");
  const count = data.readUInt16LE(eocd + 10);
  let at = data.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) throw new ZipFormatError("bad central header");
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    entries.push({
      method: data.readUInt16LE(at + 10),
      compressedSize: data.readUInt32LE(at + 20),
      uncompressedSize: data.readUInt32LE(at + 24),
      localOffset: data.readUInt32LE(at + 42),
      name: data.subarray(at + 46, at + 46 + nameLength).toString("utf8"),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function readEntry(data: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset;
  if (at + 30 > data.length || data.readUInt32LE(at) !== 0x04034b50) throw new ZipFormatError("bad local header");
  const start = at + 30 + data.readUInt16LE(at + 26) + data.readUInt16LE(at + 28);
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method !== 8) throw new ZipFormatError("unsupported compression");
  try {
    return inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
  } catch {
    throw new ZipFormatError("entry does not inflate");
  }
}

export function writeZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const packed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
