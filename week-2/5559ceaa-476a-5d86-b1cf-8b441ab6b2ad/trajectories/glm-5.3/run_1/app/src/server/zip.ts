import { createInflateRaw } from "node:zlib";
import { normalizePath, checkPath, allowedExtension, unsafeSvg } from "./paths.js";

export interface ZipEntry {
  path: string;
  bytes: Buffer;
}

export interface Rejection {
  path: string;
  reason: string;
  limit?: number;
}

const MAX_ENTRIES = 500;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 20_000_000;
const RATIO_THRESHOLD_BYTES = 10_000;
const MAX_RATIO = 100;
const MAX_LISTED = 100;

interface CentralItem {
  name: string;
  headerOffset: number;
  compressedSize: number;
  isSymlink: boolean;
}

/** The single place the zip safety rules are decided, by actually inflating every entry. */
export async function scanZip(raw: Buffer): Promise<{ entries: ZipEntry[]; rejected: Rejection[]; ignored: string[] }> {
  const rejected: Rejection[] = [];
  const ignored: string[] = [];
  if (!isZip(raw)) {
    return { entries: [], rejected: [{ path: "", reason: "not_a_zip" }], ignored };
  }
  const central = readCentralDirectory(raw);
  if (central.length > MAX_ENTRIES) {
    rejected.push({ path: "", reason: "too_many_entries", limit: MAX_ENTRIES });
  }
  const entries: ZipEntry[] = [];
  const seenPaths = new Set<string>();
  let total = 0;
  for (const item of central.slice(0, MAX_ENTRIES)) {
    const name = normalizePath(item.name);
    if (name.startsWith("__MACOSX/") || name === ".DS_Store" || name.endsWith("/.DS_Store")) {
      ignored.push(name);
      continue;
    }
    if (name.endsWith("/")) continue;
    if (item.isSymlink) {
      rejected.push({ path: name, reason: "symlink" });
      continue;
    }
    const pc = checkPath(name);
    if (!pc.ok) {
      rejected.push({ path: name, reason: pc.code });
      continue;
    }
    if (!allowedExtension(name)) {
      rejected.push({ path: name, reason: "disallowed_type" });
      continue;
    }
    const bytes = await inflateEntry(raw, item, MAX_FILE_BYTES);
    if (bytes === null) {
      rejected.push({ path: name, reason: "content_mismatch" });
      continue;
    }
    if (bytes.includes(0)) {
      rejected.push({ path: name, reason: "content_mismatch" });
      continue;
    }
    if (bytes.length > RATIO_THRESHOLD_BYTES && item.compressedSize > 0 && bytes.length > MAX_RATIO * item.compressedSize) {
      rejected.push({ path: name, reason: "ratio_exceeded", limit: MAX_RATIO });
      continue;
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) {
      rejected.push({ path: name, reason: "total_too_large", limit: MAX_TOTAL_BYTES });
      continue;
    }
    if (unsafeSvg(name, bytes)) {
      rejected.push({ path: name, reason: "unsafe_svg" });
      continue;
    }
    if (seenPaths.has(name)) {
      rejected.push({ path: name, reason: "duplicate_path" });
      continue;
    }
    seenPaths.add(name);
    entries.push({ path: name, bytes });
  }
  return { entries, rejected: rejected.slice(0, MAX_LISTED), ignored };
}

function isZip(raw: Buffer): boolean {
  return (
    raw.length >= 4 &&
    raw[0] === 0x50 &&
    raw[1] === 0x4b &&
    (raw[2] === 3 || raw[2] === 5 || raw[2] === 7)
  );
}

function findEocd(raw: Buffer): number {
  for (let i = raw.length - 22; i >= 0; i--) {
    if (raw.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readCentralDirectory(raw: Buffer): CentralItem[] {
  const eocd = findEocd(raw);
  if (eocd === -1) return [];
  const count = raw.readUInt16LE(eocd + 10);
  const cdOffset = raw.readUInt32LE(eocd + 16);
  const items: CentralItem[] = [];
  let offset = cdOffset;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > raw.length) break;
    if (raw.readUInt32LE(offset) !== 0x02014b50) break;
    const compressedSize = raw.readUInt32LE(offset + 20);
    const nameLen = raw.readUInt16LE(offset + 28);
    const extraLen = raw.readUInt16LE(offset + 30);
    const commentLen = raw.readUInt16LE(offset + 32);
    const externalAttrs = raw.readUInt32LE(offset + 38);
    const headerOffset = raw.readUInt32LE(offset + 42);
    const name = raw.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    const unixMode = Math.floor(externalAttrs / 0x10000) & 0xffff;
    items.push({ name, headerOffset, compressedSize, isSymlink: (unixMode & 0xf000) === 0xa000 });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return items;
}

function inflateEntry(raw: Buffer, item: CentralItem, limitBytes: number): Promise<Buffer | null> {
  const off = item.headerOffset;
  if (off + 30 > raw.length) return Promise.resolve(null);
  if (raw.readUInt32LE(off) !== 0x04034b50) return Promise.resolve(null);
  const method = raw.readUInt16LE(off + 8);
  const compressedSize = raw.readUInt32LE(off + 18);
  const nameLen = raw.readUInt16LE(off + 26);
  const extraLen = raw.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const data = raw.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) {
    return Promise.resolve(data.length > limitBytes ? null : Buffer.from(data));
  }
  if (method !== 8) return Promise.resolve(null);
  return new Promise<Buffer | null>((resolve) => {
    const inflate = createInflateRaw();
    const chunks: Buffer[] = [];
    let total = 0;
    let stopped = false;
    inflate.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        stopped = true;
        inflate.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    inflate.on("end", () => {
      if (!stopped) resolve(Buffer.concat(chunks));
    });
    inflate.on("error", () => resolve(null));
    inflate.end(data);
  });
}
