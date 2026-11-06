import { decodePhoto, resize, encodeJpeg } from "../infra/images.js";
import { createHash } from "node:crypto";
import { S3Client, type S3Config } from "../infra/s3.js";
import { config } from "../config.js";

export const PORTFOLIO_PHOTO_LIMIT = 12_000_000;
export const APPLICATION_PHOTO_LIMIT = 8_000_000;
export const LONG_SIDE_MAX = 2400;

export class StorageOutage extends Error {}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    const cfg: S3Config = {
      endpoint: config.s3.endpoint || "http://127.0.0.1:9000",
      region: config.s3.region,
      bucket: config.s3.bucket,
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
      forcePathStyle: config.s3.forcePathStyle,
    };
    client = new S3Client(cfg);
  }
  return client;
}

/** Runs a MinIO operation, converting any failure into a StorageOutage. */
export async function withStorage<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new StorageOutage(err instanceof Error ? err.message : String(err));
  }
}

export async function checkBucket(): Promise<void> {
  await withStorage(() => s3().ensureBucket());
}

/** Normalise an uploaded photo: apply orientation, strip metadata, cap the long side, encode JPEG. */
export async function normalizePhoto(buffer: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const decoded = await decodePhoto(buffer);
  if (!decoded) throw new Error("not decodable");
  const resized = resize(decoded, LONG_SIDE_MAX);
  const encoded = await encodeJpeg(resized, 82);
  return { buffer: encoded, width: resized.width, height: resized.height };
}

export async function decodeCheck(buffer: Buffer): Promise<boolean> {
  const decoded = await decodePhoto(buffer);
  return decoded !== null;
}

export async function storeObject(key: string, body: Buffer, _contentType: string): Promise<void> {
  void _contentType;
  await withStorage(() => s3().putObject(key, body));
}

export async function loadObject(key: string): Promise<Buffer> {
  return withStorage(() => s3().getObject(key));
}

export async function deleteObject(key: string): Promise<void> {
  await withStorage(() => s3().deleteObject(key));
}

export function portfolioKey(talentId: string, photoId: string): string {
  return `portfolio/${talentId}/${photoId}.jpg`;
}

export function applicationKey(applicationId: string, slot: string): string {
  return `applications/${applicationId}/${slot}.jpg`;
}

export function packageZipKey(packageId: string): string {
  return `packages/${packageId}/photos.zip`;
}

export function statementKey(talentId: string, month: string): string {
  return `statements/${talentId}/${month}.csv`;
}

export async function storePortfolioPhoto(talentId: string, photoId: string, buffer: Buffer): Promise<{ width: number; height: number }> {
  const normalized = await normalizePhoto(buffer);
  await storeObject(portfolioKey(talentId, photoId), normalized.buffer, "image/jpeg");
  return { width: normalized.width, height: normalized.height };
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** Builds a ZIP archive with STORE (no compression) entries. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const date = new Date();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, entry.data);
    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(0, 8);
    centralEntry.writeUInt16LE(0, 10);
    centralEntry.writeUInt16LE(dosTime, 12);
    centralEntry.writeUInt16LE(dosDate, 14);
    centralEntry.writeUInt32LE(crc, 16);
    centralEntry.writeUInt32LE(entry.data.length, 20);
    centralEntry.writeUInt32LE(entry.data.length, 24);
    centralEntry.writeUInt16LE(nameBuf.length, 28);
    centralEntry.writeUInt16LE(0, 30);
    centralEntry.writeUInt16LE(0, 32);
    centralEntry.writeUInt16LE(0, 34);
    centralEntry.writeUInt16LE(0, 36);
    centralEntry.writeUInt32LE(0, 38);
    centralEntry.writeUInt32LE(offset, 42);
    central.push(centralEntry, nameBuf);
    offset += local.length + nameBuf.length + entry.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
