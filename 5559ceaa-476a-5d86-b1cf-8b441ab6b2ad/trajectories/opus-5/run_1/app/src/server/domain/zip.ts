import { inflateRawSync } from 'node:zlib';
import type { RejectedEntry } from '../../shared/api.js';
import { limits } from '../config.js';
import { checkContent, checkPath, normalisePath } from './paths.js';

export interface ZipFileEntry {
  path: string;
  bytes: Buffer;
}

export type ZipReading =
  | { accepted: true; files: ZipFileEntry[]; ignored: string[] }
  | { accepted: false; problems: RejectedEntry[] };

interface RawEntry {
  name: string;
  compressedSize: number;
  localHeaderOffset: number;
  compressionMethod: number;
  unixMode: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;

function readCentralDirectory(archive: Buffer): RawEntry[] | null {
  const lowest = Math.max(0, archive.length - 66_000);
  let eocd = -1;
  for (let at = archive.length - 22; at >= lowest; at -= 1) {
    if (archive.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = archive.readUInt16LE(eocd + 10);
  let at = archive.readUInt32LE(eocd + 16);
  const entries: RawEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== CENTRAL_SIGNATURE) return null;
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    entries.push({
      name: archive.subarray(at + 46, at + 46 + nameLength).toString('utf8'),
      compressionMethod: archive.readUInt16LE(at + 10),
      compressedSize: archive.readUInt32LE(at + 20),
      unixMode: archive.readUInt32LE(at + 38) >>> 16,
      localHeaderOffset: archive.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function packedBytes(archive: Buffer, entry: RawEntry): Buffer | null {
  const at = entry.localHeaderOffset;
  if (at + 30 > archive.length) return null;
  const nameLength = archive.readUInt16LE(at + 26);
  const extraLength = archive.readUInt16LE(at + 28);
  const start = at + 30 + nameLength + extraLength;
  return archive.subarray(start, start + entry.compressedSize);
}

type Inflated = { ok: true; bytes: Buffer } | { ok: false; reason: 'file_too_large' | 'not_a_zip' };

function inflate(archive: Buffer, entry: RawEntry): Inflated {
  const packed = packedBytes(archive, entry);
  if (packed === null) return { ok: false, reason: 'not_a_zip' };
  if (entry.compressionMethod === 0) {
    return packed.length > limits.zipFileBytes
      ? { ok: false, reason: 'file_too_large' }
      : { ok: true, bytes: Buffer.from(packed) };
  }
  if (entry.compressionMethod !== 8) return { ok: false, reason: 'not_a_zip' };
  try {
    const bytes = inflateRawSync(packed, { maxOutputLength: limits.zipFileBytes + 1 });
    return bytes.length > limits.zipFileBytes
      ? { ok: false, reason: 'file_too_large' }
      : { ok: true, bytes };
  } catch {
    return { ok: false, reason: 'file_too_large' };
  }
}

function isIgnored(path: string): boolean {
  if (path.startsWith('__MACOSX/')) return true;
  const segments = path.split('/');
  return segments[segments.length - 1] === '.DS_Store';
}

/** The one place the published zip limits and entry rules are applied. */
export function readZip(archive: Buffer): ZipReading {
  const entries = readCentralDirectory(archive);
  if (entries === null) return { accepted: false, problems: [{ path: '', reason: 'not_a_zip' }] };

  const problems: RejectedEntry[] = [];
  if (entries.length > limits.zipEntries) {
    problems.push({ path: '', reason: 'too_many_entries', limit: limits.zipEntries });
  }

  const files: ZipFileEntry[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  let totalReported = false;

  for (const entry of entries) {
    const path = normalisePath(entry.name);
    if (isIgnored(path)) {
      ignored.push(path);
      continue;
    }
    if ((entry.unixMode & S_IFMT) === S_IFLNK) {
      problems.push({ path, reason: 'symlink' });
      continue;
    }
    if (entry.name.endsWith('/')) continue;

    const pathProblem = checkPath(path);
    if (pathProblem !== null) {
      problems.push({
        path,
        reason: pathProblem,
        ...(pathProblem === 'path_too_long' ? { limit: limits.pathChars } : {}),
      });
      continue;
    }
    if (seen.has(path)) {
      problems.push({ path, reason: 'duplicate_path' });
      continue;
    }
    seen.add(path);

    const inflated = inflate(archive, entry);
    if (!inflated.ok) {
      problems.push({
        path,
        reason: inflated.reason,
        ...(inflated.reason === 'file_too_large' ? { limit: limits.zipFileBytes } : {}),
      });
      continue;
    }
    const bytes = inflated.bytes;
    if (
      bytes.length > limits.zipRatioFloorBytes &&
      bytes.length > limits.zipRatio * entry.compressedSize
    ) {
      problems.push({ path, reason: 'ratio_exceeded', limit: limits.zipRatio });
      continue;
    }

    total += bytes.length;
    if (total > limits.zipTotalBytes && !totalReported) {
      totalReported = true;
      problems.push({ path, reason: 'total_too_large', limit: limits.zipTotalBytes });
      continue;
    }

    const contentProblem = checkContent(path, bytes);
    if (contentProblem !== null) {
      problems.push({ path, reason: contentProblem });
      continue;
    }
    files.push({ path, bytes });
  }

  if (problems.length > 0) return { accepted: false, problems: problems.slice(0, 100) };
  return { accepted: true, files, ignored };
}
