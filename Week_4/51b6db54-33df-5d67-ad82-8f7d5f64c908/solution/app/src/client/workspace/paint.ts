/** Draws 1x RGBA pixels onto a canvas of exactly width*zoom by height*zoom, with hard edges. */
export function paintPixels(canvas: HTMLCanvasElement, rgba: Uint8Array, width: number, height: number, zoom: number, under?: Uint8Array | null): void {
  if (canvas.width !== width * zoom) canvas.width = width * zoom;
  if (canvas.height !== height * zoom) canvas.height = height * zoom;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (under) {
    sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(under), width, height), 0, 0);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  sourceCtx.clearRect(0, 0, width, height);
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
}

/** Onion skin pixels: a previous frame tinted towards cornflower and made see-through. */
export function onionTint(rgba: Uint8Array, strength: number): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let at = 0; at < rgba.length; at += 4) {
    const alpha = rgba[at + 3] ?? 0;
    if (alpha === 0) continue;
    out[at] = Math.round(((rgba[at] ?? 0) + 90) / 2);
    out[at + 1] = Math.round(((rgba[at + 1] ?? 0) + 130) / 2);
    out[at + 2] = Math.round(((rgba[at + 2] ?? 0) + 255) / 2);
    out[at + 3] = Math.round(alpha * strength);
  }
  return out;
}
