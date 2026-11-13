import { base64urlEncode } from '../../shared/scheme.js';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_EDGE = 2048;
const THUMB_EDGE = 32;

export class WrongPhotoType extends Error {
  constructor() {
    super('wrong photo type');
    this.name = 'WrongPhotoType';
  }
}

export interface PreparedPhoto {
  bytes: Uint8Array;
  width: number;
  height: number;
  thumb: string;
  type: 'image/jpeg';
}

function scaled(width: number, height: number, edge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= edge) return { width, height };
  const factor = edge / longest;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

async function reencode(
  bitmap: ImageBitmap,
  edge: number,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const size = scaled(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('no canvas context');
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.82),
  );
  if (blob === null) throw new Error('photo could not be re-encoded');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ...size };
}

/** A photo is drawn and re-encoded here, so no location or camera metadata survives. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!PHOTO_TYPES.includes(file.type)) throw new WrongPhotoType();
  const bitmap = await createImageBitmap(file);
  const full = await reencode(bitmap, MAX_EDGE);
  const thumb = await reencode(bitmap, THUMB_EDGE);
  bitmap.close();
  return {
    bytes: full.bytes,
    width: full.width,
    height: full.height,
    thumb: base64urlEncode(thumb.bytes),
    type: 'image/jpeg',
  };
}
