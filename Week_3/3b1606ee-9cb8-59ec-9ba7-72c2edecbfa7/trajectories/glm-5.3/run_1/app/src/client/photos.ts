// Photo preparation: re-encoded in the browser, no metadata, long edge at most 2048, tiny blurred thumb.
// DP-18, DP-21.
export interface PreparedPhoto {
  bytes: Uint8Array; // the JPEG bytes
  width: number;
  height: number;
  thumb: string; // base64url JPEG, long edge <= 32px
  type: string;
}

const MAX_EDGE = 2048;
const THUMB_EDGE = 32;

function loadImage(file: File): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ bitmap: img as unknown as ImageBitmap, width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}

function drawScaled(source: ImageBitmap | HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  return canvas;
}

function canvasBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('encode failed'));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)));
    }, 'image/jpeg', quality);
  });
}

function b64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A photo is drawn and re-encoded as JPEG: no EXIF, no location, no camera metadata. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const { bitmap, width, height } = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const main = drawScaled(bitmap, targetWidth, targetHeight);
  const bytes = await canvasBytes(main, 0.9);

  const thumbScale = Math.min(1, THUMB_EDGE / Math.max(width, height));
  const thumbWidth = Math.max(1, Math.round(width * thumbScale));
  const thumbHeight = Math.max(1, Math.round(height * thumbScale));
  const thumbCanvas = drawScaled(bitmap, thumbWidth, thumbHeight);
  const thumbBytes = await canvasBytes(thumbCanvas, 0.7);

  return { bytes, width: targetWidth, height: targetHeight, thumb: b64Url(thumbBytes), type: 'image/jpeg' };
}
