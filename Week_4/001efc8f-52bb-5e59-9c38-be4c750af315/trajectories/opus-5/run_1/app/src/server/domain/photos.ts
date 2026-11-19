import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { LIMITS } from '../config';
import { fileTooLarge, fileTooManyPixels, fileWrongType, FIELD_COPY } from '../../shared/copy';

export interface UploadedPart {
  filename: string;
  buffer: Buffer;
}

export interface PreparedPhoto {
  attachmentId: string;
  filename: string;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  sourceHash: string;
  original: Buffer;
  thumbnail: Buffer;
}

type Format = 'jpeg' | 'png' | 'webp';

const CONTENT_TYPES: Record<Format, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export class PhotoRejected extends Error {
  public readonly copy: string;

  constructor(copy: string) {
    super(copy);
    this.copy = copy;
  }
}

/** The stored file name: base name, safe characters only, cut to 100. */
export function storedFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return safe.length === 0 ? 'photo' : safe;
}

function signatureFormat(buffer: Buffer): Format | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/**
 * The one photo acceptance order: type, then size, then declared pixels, then
 * a full decode. The first failing check is the part's reason.
 */
export async function preparePhoto(part: UploadedPart): Promise<PreparedPhoto> {
  const filename = storedFilename(part.filename);
  const format = signatureFormat(part.buffer);
  if (format === null) throw new PhotoRejected(fileWrongType(filename));

  let header: sharp.Metadata;
  try {
    header = await sharp(part.buffer, { limitInputPixels: false, failOn: 'none' }).metadata();
  } catch {
    throw new PhotoRejected(fileWrongType(filename));
  }
  if (header.width === undefined || header.height === undefined) throw new PhotoRejected(fileWrongType(filename));

  if (part.buffer.length > LIMITS.photoBytes) throw new PhotoRejected(fileTooLarge(filename));

  if (header.width * header.height > LIMITS.photoPixels) throw new PhotoRejected(fileTooManyPixels(filename));

  let original: Buffer;
  let width: number;
  let height: number;
  try {
    const pipeline = sharp(part.buffer, { limitInputPixels: LIMITS.photoPixels })
      .rotate()
      .toColorspace('srgb')
      .toFormat(format);
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    original = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch {
    throw new PhotoRejected(fileWrongType(filename));
  }

  const thumbnail = await sharp(original, { limitInputPixels: LIMITS.photoPixels })
    .resize({ width: LIMITS.thumbLongestSide, height: LIMITS.thumbLongestSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return {
    attachmentId: randomUUID(),
    filename,
    contentType: CONTENT_TYPES[format],
    bytes: original.length,
    width,
    height,
    sourceHash: createHash('sha256').update(part.buffer).digest('hex'),
    original,
    thumbnail,
  };
}

export async function preparePhotos(parts: UploadedPart[]): Promise<PreparedPhoto[]> {
  if (parts.length > LIMITS.photosPerMessage) throw new PhotoRejected(FIELD_COPY.filesTooMany);
  const prepared: PreparedPhoto[] = [];
  for (const part of parts) prepared.push(await preparePhoto(part));
  return prepared;
}

export function originalKey(workspaceId: string, messageId: string, attachmentId: string): string {
  return `attachments/${workspaceId}/${messageId}/${attachmentId}/original`;
}

export function thumbKey(workspaceId: string, messageId: string, attachmentId: string): string {
  return `attachments/${workspaceId}/${messageId}/${attachmentId}/thumb.jpg`;
}
