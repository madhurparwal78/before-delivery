import sharp from 'sharp';
import type { Store } from './store.js';
import { sha256Hex, uuid } from './crypto.js';

export interface UploadInput { kind: 'photo' | 'invoice'; fileName: string; bytes: Buffer; label?: string | null; plateMask?: { x: number; y: number; w: number; h: number } | null }
export interface StoredUpload {
  id: string; kind: string; status: 'stored'; fileName: string; sha256: string; bytes: number;
  contentType: string; derivativeSha256: string | null; locationRemoved: boolean; label: string | null;
}

export class UploadError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const PHOTO_TYPES = ['image/jpeg', 'image/png'];
const INVOICE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

/** GPS metadata detection: any EXIF GPS block means the original held location data. */
function hasGps(bytes: Buffer, isRaster: boolean): boolean {
  if (!isRaster) return false;
  return bytes.indexOf(Buffer.from('GPS', 'ascii')) !== -1;
}

function unsafeName(fileName: string): boolean {
  return fileName.includes('/') || fileName.includes('\\') || fileName.includes('..') || fileName.includes('\0');
}

/** Judge an upload by its content, produce the derivative, and store both or nothing. */
export async function storeUpload(store: Store, carId: string, input: UploadInput): Promise<StoredUpload> {
  const contentType = await sniffType(input.bytes);
  const allowed = input.kind === 'photo' ? PHOTO_TYPES : INVOICE_TYPES;
  if (!contentType || !allowed.includes(contentType)) {
    throw new UploadError('unsupported_file', 'This file type is not accepted', 415);
  }
  if (unsafeName(input.fileName)) {
    throw new UploadError('bad_name', 'That file name is not allowed', 422);
  }
  const id = uuid();
  const originalSha = sha256Hex(input.bytes);
  let derivativeSha: string | null = null;
  let locationRemoved = false;
  let derivative: Buffer | null = null;
  if (input.kind === 'photo') {
    try {
      locationRemoved = hasGps(input.bytes, true);
      // The upright base: rotate by the orientation tag, then scale the long edge to 1600.
      const uprightInfo = await sharp(input.bytes, { failOn: 'error' }).rotate().metadata();
      const longEdge = Math.max(uprightInfo.width ?? 0, uprightInfo.height ?? 0);
      let base = sharp(input.bytes, { failOn: 'error' }).rotate();
      if (longEdge > 1600) {
        base = base.resize({ width: (uprightInfo.width ?? 0) >= (uprightInfo.height ?? 0) ? 1600 : undefined, height: (uprightInfo.height ?? 0) > (uprightInfo.width ?? 0) ? 1600 : undefined });
      }
      const upright = await base.toBuffer({ resolveWithObject: true });
      const w = upright.info.width;
      const h = upright.info.height;
      if (!w || !h) throw new Error('empty image');
      let composed = sharp(upright.data, { failOn: 'error' });
      if (input.plateMask) {
        const rect = {
          left: Math.round(input.plateMask.x * w), top: Math.round(input.plateMask.y * h),
          width: Math.max(1, Math.round(input.plateMask.w * w)), height: Math.max(1, Math.round(input.plateMask.h * h)),
        };
        const maskSvg = Buffer.from(`<svg width="${w}" height="${h}"><rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="#141422"/></svg>`);
        composed = composed.composite([{ input: maskSvg, top: 0, left: 0 }]);
      }
      derivative = await composed.jpeg({ quality: 84 }).toBuffer();
      derivativeSha = sha256Hex(derivative);
    } catch (err) {
      if (err instanceof UploadError) throw err;
      throw new UploadError('unsupported_file', 'This file type is not accepted', 415);
    }
  }

  const upload: StoredUpload = {
    id, kind: input.kind, status: 'stored', fileName: input.fileName, sha256: originalSha,
    bytes: input.bytes.length, contentType, derivativeSha256: derivativeSha, locationRemoved, label: input.label === undefined ? null : input.label,
  };
  // Original and derivative land together: put both, then read them back to confirm.
  try {
    await store.put(store.originalKey(carId, id), input.bytes, contentType);
    if (input.kind === 'photo') {
      if (!derivative || !derivativeSha) throw new Error('missing derivative');
      await store.put(store.derivativeKey(carId, id), derivative, 'image/jpeg');
    }
    const back = await store.get(store.originalKey(carId, id));
    if (sha256Hex(back) !== originalSha) throw new Error('original hash mismatch');
    if (input.kind === 'photo' && derivativeSha) {
      const dback = await store.get(store.derivativeKey(carId, id));
      if (sha256Hex(dback) !== derivativeSha) throw new Error('derivative hash mismatch');
    }
  } catch (err) {
    await store.del(store.originalKey(carId, id)).catch(() => undefined);
    await store.del(store.derivativeKey(carId, id)).catch(() => undefined);
    throw new UploadError('storage_unavailable', 'Photo storage is not answering. Nothing was saved. Try again shortly.', 503);
  }
  return upload;
}

async function sniffType(bytes: Buffer): Promise<string | null> {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    try { await sharp(bytes, { failOn: 'error' }).metadata(); return 'image/jpeg'; } catch { return null; }
  }
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) {
    try { await sharp(bytes, { failOn: 'error' }).metadata(); return 'image/png'; } catch { return null; }
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}
