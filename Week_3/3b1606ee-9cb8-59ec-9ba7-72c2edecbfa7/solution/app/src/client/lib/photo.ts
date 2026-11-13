import { toBase64url } from './base64';

export const PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_EDGE = 2048;
export const PROFILE_PHOTO_EDGE = 640;
const THUMB_EDGE = 32;

interface PreparedPhoto {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  thumb: string;
}

async function jpeg(source: ImageBitmap, width: number, height: number, quality: number): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('the photo could not be drawn');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Draws the photo and re-encodes it as JPEG, so no location or camera metadata survives: at most `edge` pixels on its
 * long edge, never enlarged, with a tiny thumbnail made the same way.
 */
export async function preparePhoto(file: Blob, edge: number = PHOTO_EDGE): Promise<PreparedPhoto> {
  const source = await createImageBitmap(file);
  const long = Math.max(source.width, source.height);
  const fit = (limit: number): [number, number] => {
    const scale = Math.min(1, limit / long);
    return [Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale))];
  };
  const [width, height] = fit(edge);
  const [thumbWidth, thumbHeight] = fit(THUMB_EDGE);
  const bytes = await jpeg(source, width, height, 0.86);
  const thumb = await jpeg(source, thumbWidth, thumbHeight, 0.7);
  source.close();
  return { bytes, width, height, thumb: toBase64url(thumb) };
}
