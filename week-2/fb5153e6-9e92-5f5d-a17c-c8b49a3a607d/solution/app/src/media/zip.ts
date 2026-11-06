import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Buffer;
}

export class ZipReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipReadError';
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEocd(bytes: Buffer): number {
  const earliest = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= earliest; i -= 1) {
    if (bytes.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new ZipReadError('No end-of-central-directory record');
}

/** Reads every entry's name and bytes. Directory entries are left out. */
export function readZip(bytes: Buffer): readonly ZipEntry[] {
  const eocd = findEocd(bytes);
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipReadError('A central directory record is malformed');
    }
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;

    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ZipReadError('A local file header is malformed');
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    let content: Buffer;
    if (method === 0) {
      content = Buffer.from(raw);
    } else if (method === 8) {
      try {
        content = inflateRawSync(raw);
      } catch {
        throw new ZipReadError(`Entry ${name} could not be inflated`);
      }
    } else {
      throw new ZipReadError(`Entry ${name} uses an unsupported compression method`);
    }
    entries.push({ name, bytes: content });
  }
  return entries;
}

/** An entry whose path leaves its folder: `..`, absolute, a drive letter or a backslash. */
export function escapesFolder(name: string): boolean {
  if (name.includes('\\')) return true;
  if (name.startsWith('/')) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  return name.split('/').includes('..');
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A texture set's entries are checked one by one, by content. */
export function isPngOrJpeg(bytes: Buffer): boolean {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) return true;
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
