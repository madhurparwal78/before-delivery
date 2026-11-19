export const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32] as const;

/** The default is 8, or the largest level that fits the stage viewport. */
export function fitZoom(width: number, height: number, viewport: { w: number; h: number }): number {
  if (width * 8 <= viewport.w && height * 8 <= viewport.h) return 8;
  const fitting = [...ZOOM_LEVELS].filter(
    (zoom) => width * zoom <= viewport.w && height * zoom <= viewport.h,
  );
  return fitting.length === 0 ? 1 : (fitting[fitting.length - 1] as number);
}

export function stepZoom(current: number, direction: 1 | -1): number {
  const at = ZOOM_LEVELS.indexOf(current as (typeof ZOOM_LEVELS)[number]);
  const next = Math.min(Math.max(at + direction, 0), ZOOM_LEVELS.length - 1);
  return ZOOM_LEVELS[next];
}

/** Hard pixel edges: no blur, no scaling beyond the whole-number zoom. */
export function paintPixels(
  canvas: HTMLCanvasElement,
  rgba: Uint8Array,
  width: number,
  height: number,
  zoom: number,
): void {
  canvas.width = width * zoom;
  canvas.height = height * zoom;
  canvas.style.width = `${width * zoom}px`;
  canvas.style.height = `${height * zoom}px`;
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const alpha = rgba[at + 3];
      if (alpha === 0) continue;
      context.fillStyle = `rgba(${rgba[at]},${rgba[at + 1]},${rgba[at + 2]},${alpha / 255})`;
      context.fillRect(x * zoom, y * zoom, zoom, zoom);
    }
  }
}

export function rowsToBytes(rows: string[][]): Uint8Array {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const out = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    row.forEach((colour, x) => {
      const at = (y * width + x) * 4;
      out[at] = parseInt(colour.slice(0, 2), 16);
      out[at + 1] = parseInt(colour.slice(2, 4), 16);
      out[at + 2] = parseInt(colour.slice(4, 6), 16);
      out[at + 3] = parseInt(colour.slice(6, 8), 16);
    });
  });
  return out;
}
