/** A tiny deterministic rasteriser used to draw the stand-in object photographs. */

export type Rgb = [number, number, number];

export interface Shape {
  kind: 'rect' | 'roundedRect' | 'ellipse' | 'polygon';
  colour: Rgb;
  /** Normalised 0..1 coordinates inside the image. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: Array<[number, number]>;
}

const SUPERSAMPLE = 2;

export class Raster {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Float64Array;

  constructor(width: number, height: number) {
    this.width = width * SUPERSAMPLE;
    this.height = height * SUPERSAMPLE;
    this.pixels = new Float64Array(this.width * this.height * 3);
  }

  fill(colour: Rgb): void {
    for (let index = 0; index < this.pixels.length; index += 3) {
      this.pixels[index] = colour[0];
      this.pixels[index + 1] = colour[1];
      this.pixels[index + 2] = colour[2];
    }
  }

  /** A soft top-to-bottom wash, so the backdrop is not a flat block. */
  verticalWash(top: Rgb, bottom: Rgb): void {
    for (let y = 0; y < this.height; y += 1) {
      const t = y / (this.height - 1);
      const row = y * this.width * 3;
      for (let x = 0; x < this.width; x += 1) {
        const index = row + x * 3;
        this.pixels[index] = top[0] + (bottom[0] - top[0]) * t;
        this.pixels[index + 1] = top[1] + (bottom[1] - top[1]) * t;
        this.pixels[index + 2] = top[2] + (bottom[2] - top[2]) * t;
      }
    }
  }

  private plot(x: number, y: number, colour: Rgb): void {
    const index = (y * this.width + x) * 3;
    this.pixels[index] = colour[0];
    this.pixels[index + 1] = colour[1];
    this.pixels[index + 2] = colour[2];
  }

  draw(shape: Shape): void {
    const inside = this.testFor(shape);
    const bounds = this.boundsFor(shape);
    for (let y = bounds.top; y < bounds.bottom; y += 1) {
      for (let x = bounds.left; x < bounds.right; x += 1) {
        if (inside(x + 0.5, y + 0.5)) this.plot(x, y, shape.colour);
      }
    }
  }

  private boundsFor(shape: Shape): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    const clamp = (value: number, limit: number): number =>
      Math.max(0, Math.min(limit, Math.round(value)));
    if (shape.kind === 'polygon') {
      const points = shape.points ?? [];
      const xs = points.map(([x]) => x * this.width);
      const ys = points.map(([, y]) => y * this.height);
      return {
        left: clamp(Math.min(...xs), this.width),
        top: clamp(Math.min(...ys), this.height),
        right: clamp(Math.max(...xs) + 1, this.width),
        bottom: clamp(Math.max(...ys) + 1, this.height),
      };
    }
    const left = (shape.x ?? 0) * this.width;
    const top = (shape.y ?? 0) * this.height;
    return {
      left: clamp(left, this.width),
      top: clamp(top, this.height),
      right: clamp(left + (shape.width ?? 0) * this.width + 1, this.width),
      bottom: clamp(top + (shape.height ?? 0) * this.height + 1, this.height),
    };
  }

  private testFor(shape: Shape): (x: number, y: number) => boolean {
    if (shape.kind === 'polygon') {
      const points = (shape.points ?? []).map(
        ([x, y]) => [x * this.width, y * this.height] as [number, number],
      );
      return (x, y) => pointInPolygon(x, y, points);
    }
    const left = (shape.x ?? 0) * this.width;
    const top = (shape.y ?? 0) * this.height;
    const width = (shape.width ?? 0) * this.width;
    const height = (shape.height ?? 0) * this.height;
    if (shape.kind === 'rect') {
      return (x, y) => x >= left && x < left + width && y >= top && y < top + height;
    }
    if (shape.kind === 'ellipse') {
      const centreX = left + width / 2;
      const centreY = top + height / 2;
      return (x, y) =>
        ((x - centreX) / (width / 2)) ** 2 + ((y - centreY) / (height / 2)) ** 2 <= 1;
    }
    const radius = Math.min((shape.radius ?? 0) * this.width, width / 2, height / 2);
    return (x, y) => {
      if (x < left || x >= left + width || y < top || y >= top + height) return false;
      const dx = Math.max(left + radius - x, 0, x - (left + width - radius));
      const dy = Math.max(top + radius - y, 0, y - (top + height - radius));
      return dx * dx + dy * dy <= radius * radius;
    };
  }

  /** Box-downsamples the supersampled buffer to 8-bit RGBA. */
  toRgba(): { width: number; height: number; data: Buffer } {
    const width = this.width / SUPERSAMPLE;
    const height = this.height / SUPERSAMPLE;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
          for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
            const index = ((y * SUPERSAMPLE + sy) * this.width + x * SUPERSAMPLE + sx) * 3;
            red += this.pixels[index]!;
            green += this.pixels[index + 1]!;
            blue += this.pixels[index + 2]!;
          }
        }
        const samples = SUPERSAMPLE * SUPERSAMPLE;
        const target = (y * width + x) * 4;
        data[target] = Math.round(red / samples);
        data[target + 1] = Math.round(green / samples);
        data[target + 2] = Math.round(blue / samples);
        data[target + 3] = 255;
      }
    }
    return { width, height, data };
  }
}

function pointInPolygon(x: number, y: number, points: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
