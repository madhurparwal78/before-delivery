import { crc32, inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  bytes: Buffer;
}

const MAX_ENTRIES = 20_000;
const MAX_UNPACKED_BYTES = 300_000_000;

export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, entry.bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(entry.bytes.length, 20);
    record.writeUInt32LE(entry.bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Reads stored and deflated entries; returns null when the bytes are not a readable zip. */
export function readZip(data: Buffer): ZipEntry[] | null {
  const endAt = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || endAt + 22 > data.length) return null;
  const count = data.readUInt16LE(endAt + 10);
  let cursor = data.readUInt32LE(endAt + 16);
  if (count > MAX_ENTRIES) return null;
  const entries: ZipEntry[] = [];
  let unpacked = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) return null;
    const method = data.readUInt16LE(cursor + 10);
    const compressed = data.readUInt32LE(cursor + 20);
    const size = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localAt = data.readUInt32LE(cursor + 42);
    const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (localAt + 30 > data.length || data.readUInt32LE(localAt) !== 0x04034b50) return null;
    const start = localAt + 30 + data.readUInt16LE(localAt + 26) + data.readUInt16LE(localAt + 28);
    const body = data.subarray(start, start + compressed);
    unpacked += size;
    if (unpacked > MAX_UNPACKED_BYTES || body.length !== compressed) return null;
    try {
      const bytes = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body, { maxOutputLength: MAX_UNPACKED_BYTES }) : null;
      if (!bytes) return null;
      entries.push({ name, bytes });
    } catch {
      return null;
    }
  }
  return entries;
}
