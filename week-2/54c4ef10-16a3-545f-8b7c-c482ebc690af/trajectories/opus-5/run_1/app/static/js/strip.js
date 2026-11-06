// Drawing a strip, its frame crops and the loupe from the scan's preview slices.
import { inkColour, tintCanvas } from './negative.js';

export const SLICE_WIDTH = 2048;
export const LOUPE_SIZE = 120;
export const LOUPE_MAGNIFICATION = 4;
export const SAMPLE_CELL = 8;

export class StripPreview {
  constructor(scan) {
    this.scan = scan;
    this.slices = [];
    this.available = false;
  }

  async load() {
    const loads = [];
    for (let index = 0; index < this.scan.preview_slices; index += 1) {
      loads.push(
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => resolve(null);
          image.src = `/api/scans/${this.scan.id}/preview/${index}`;
        }),
      );
    }
    this.slices = await Promise.all(loads);
    this.available = this.slices.length > 0 && this.slices.every((item) => item !== null);
    return this.available;
  }

  // Draws the scan rectangle [x0, x1) x [y0, y1) into the whole canvas.
  drawRegion(canvas, x0, y0, x1, y1, { smooth = true } = {}) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = smooth;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scaleX = canvas.width / (x1 - x0);
    const scaleY = canvas.height / (y1 - y0);
    this.slices.forEach((image, index) => {
      if (!image) return;
      const sliceStart = index * SLICE_WIDTH;
      const sliceStop = sliceStart + image.width;
      const from = Math.max(x0, sliceStart);
      const to = Math.min(x1, sliceStop);
      if (to <= from) return;
      context.drawImage(
        image,
        from - sliceStart,
        y0,
        to - from,
        y1 - y0,
        (from - x0) * scaleX,
        0,
        (to - from) * scaleX,
        (y1 - y0) * scaleY,
      );
    });
    tintCanvas(canvas);
  }

  drawWhole(canvas) {
    this.drawRegion(canvas, 0, 0, this.scan.width, this.scan.height);
  }

  drawCrop(canvas, x0, x1) {
    this.drawRegion(canvas, x0, 0, x1, this.scan.height);
  }

  // Four times magnification with hard-edged scan pixels around the cell.
  drawLoupe(canvas, cellX, cellY) {
    const visible = LOUPE_SIZE / LOUPE_MAGNIFICATION;
    const centreX = cellX + SAMPLE_CELL / 2;
    const centreY = cellY + SAMPLE_CELL / 2;
    const left = Math.round(centreX - visible / 2);
    const top = Math.round(centreY - visible / 2);
    canvas.width = LOUPE_SIZE;
    canvas.height = LOUPE_SIZE;
    this.drawRegion(canvas, left, top, left + visible, top + visible, { smooth: false });
    const context = canvas.getContext('2d');
    context.strokeStyle = inkColour();
    context.lineWidth = 1;
    context.strokeRect(
      (cellX - left) * LOUPE_MAGNIFICATION + 0.5,
      (cellY - top) * LOUPE_MAGNIFICATION + 0.5,
      SAMPLE_CELL * LOUPE_MAGNIFICATION - 1,
      SAMPLE_CELL * LOUPE_MAGNIFICATION - 1,
    );
  }
}

export function cellOrigin(x, y) {
  return [SAMPLE_CELL * Math.floor(x / SAMPLE_CELL), SAMPLE_CELL * Math.floor(y / SAMPLE_CELL)];
}
