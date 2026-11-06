// The negative tint (preview code v -> round(G + (I - G) * v / 255)) and every canvas drawing of stored previews.

import { SLICE_WIDTH } from './domain.js';

export const GROUND = [19, 54, 33];
export const GOLD = [244, 217, 108];

function tintOf(code, scale = 1) {
  return GROUND.map((g, channel) => Math.round((g + (GOLD[channel] - g) * code / 255) * scale));
}

const LUT = Array.from({ length: 256 }, (_, code) => tintOf(code));

/** Replace the grey codes in a canvas region by their tint. `scale` dims procedural prints (0.7). */
export function tintCanvas(context, width, height, scale = 1) {
  const picture = context.getImageData(0, 0, width, height);
  const pixels = picture.data;
  const table = scale === 1 ? LUT : LUT.map((_, code) => tintOf(code, scale));
  for (let i = 0; i < pixels.length; i += 4) {
    const colour = table[pixels[i]];
    pixels[i] = colour[0];
    pixels[i + 1] = colour[1];
    pixels[i + 2] = colour[2];
    pixels[i + 3] = 255;
  }
  context.putImageData(picture, 0, 0);
}

export class PreviewUnavailable extends Error {}

const sliceCache = new Map();

/** The scan's preview slices as bitmaps; rejects with PreviewUnavailable when storage refuses them. */
export function loadSlices(scan) {
  if (!sliceCache.has(scan.id)) {
    const loading = Promise.all(Array.from({ length: scan.preview_slices }, async (_, n) => {
      const response = await fetch(`/api/scans/${scan.id}/preview/${n}`, { credentials: 'same-origin' });
      if (!response.ok) throw new PreviewUnavailable(String(response.status));
      return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
    }));
    sliceCache.set(scan.id, loading);
    loading.catch(() => sliceCache.delete(scan.id));
  }
  return sliceCache.get(scan.id);
}

/** Draw scan region (sx, sy, sw, sh) of the greyscale slices into (dx, dy, dw, dh) of a 2D context. */
export function drawRegion(context, slices, region, target) {
  const [sx, sy, sw, sh] = region;
  const [dx, dy, dw, dh] = target;
  const xScale = dw / sw;
  slices.forEach((slice, n) => {
    const left = Math.max(sx, n * SLICE_WIDTH);
    const right = Math.min(sx + sw, n * SLICE_WIDTH + slice.width);
    if (right <= left) return;
    const x0 = dx + (left - sx) * xScale;
    const x1 = dx + (right - sx) * xScale;
    context.drawImage(slice, left - n * SLICE_WIDTH, sy, right - left, sh, Math.floor(x0), dy, Math.ceil(x1) - Math.floor(x0), dh);
  });
}

export function sizeCanvas(canvas, cssWidth, cssHeight) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(cssWidth * ratio));
  canvas.height = Math.max(1, Math.round(cssHeight * ratio));
  return canvas.getContext('2d', { willReadFrequently: true });
}

/** Draw a frame (x0..x1 of the strip) as a negative on a canvas, cropped to fill it when `cover` is set. */
export async function drawFrameCrop(canvas, scan, frame, { cover = false } = {}) {
  const slices = await loadSlices(scan);
  const width = canvas.clientWidth || canvas.width;
  const frameWidth = frame.x1 - frame.x0;
  let source = [frame.x0, 0, frameWidth, scan.height];
  const aspect = cover ? canvas.clientWidth / canvas.clientHeight : frameWidth / scan.height;
  if (cover) {
    const wanted = Math.min(frameWidth, scan.height * aspect);
    source = [frame.x0 + (frameWidth - wanted) / 2, 0, wanted, scan.height];
  }
  const height = cover ? canvas.clientHeight : Math.round(width * scan.height / frameWidth);
  const context = sizeCanvas(canvas, width, height);
  if (!cover) canvas.style.aspectRatio = `${frameWidth} / ${scan.height}`;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawRegion(context, slices, source, [0, 0, canvas.width, canvas.height]);
  tintCanvas(context, canvas.width, canvas.height);
}
