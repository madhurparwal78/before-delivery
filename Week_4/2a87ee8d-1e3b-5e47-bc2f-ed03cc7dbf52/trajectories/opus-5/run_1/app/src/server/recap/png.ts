import { deflateSync } from 'node:zlib';
import { shape, type TrueTypeFont } from './truetype.js';

export type Rgb = readonly [number, number, number];

/** A small RGB raster with the few drawing operations the frame PNGs need. */
export class Raster {
  private readonly pixels: Buffer;

  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = Buffer.alloc(width * height * 3);
    for (let index = 0; index < width * height; index += 1) {
      this.pixels[index * 3] = background[0];
      this.pixels[index * 3 + 1] = background[1];
      this.pixels[index * 3 + 2] = background[2];
    }
  }

  private blend(x: number, y: number, colour: Rgb, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const offset = (y * this.width + x) * 3;
    const weight = Math.min(1, alpha);
    for (let channel = 0; channel < 3; channel += 1) {
      const existing = this.pixels[offset + channel] as number;
      this.pixels[offset + channel] = Math.round(existing * (1 - weight) + (colour[channel] as number) * weight);
    }
  }

  fillRect(x: number, y: number, width: number, height: number, colour: Rgb): void {
    const left = Math.max(0, Math.round(x));
    const top = Math.max(0, Math.round(y));
    const right = Math.min(this.width, Math.round(x + width));
    const bottom = Math.min(this.height, Math.round(y + height));
    for (let row = top; row < bottom; row += 1) {
      for (let column = left; column < right; column += 1) this.blend(column, row, colour, 1);
    }
  }

  strokeRect(x: number, y: number, width: number, height: number, colour: Rgb, thickness: number): void {
    this.fillRect(x, y, width, thickness, colour);
    this.fillRect(x, y + height - thickness, width, thickness, colour);
    this.fillRect(x, y, thickness, height, colour);
    this.fillRect(x + width - thickness, y, thickness, height, colour);
  }

  /**
   * Fills a glyph's flattened contours with a scanline pass, sampling several rows per pixel
   * so edges read smoothly.
   */
  private fillPolygons(
    polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
    colour: Rgb,
  ): void {
    const samples = 4;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const polygon of polygons) {
      for (const [, y] of polygon) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minY)) return;
    const firstRow = Math.max(0, Math.floor(minY));
    const lastRow = Math.min(this.height - 1, Math.ceil(maxY));

    const coverage = new Map<number, number>();
    for (let row = firstRow; row <= lastRow; row += 1) {
      coverage.clear();
      for (let sample = 0; sample < samples; sample += 1) {
        const scanY = row + (sample + 0.5) / samples;
        const crossings: Array<{ x: number; direction: number }> = [];
        for (const polygon of polygons) {
          for (let index = 0; index < polygon.length; index += 1) {
            const [x1, y1] = polygon[index] as readonly [number, number];
            const [x2, y2] = polygon[(index + 1) % polygon.length] as readonly [number, number];
            if (y1 === y2) continue;
            if (scanY < Math.min(y1, y2) || scanY >= Math.max(y1, y2)) continue;
            const t = (scanY - y1) / (y2 - y1);
            crossings.push({ x: x1 + t * (x2 - x1), direction: y2 > y1 ? 1 : -1 });
          }
        }
        if (crossings.length === 0) continue;
        crossings.sort((left, right) => left.x - right.x);
        // Non-zero winding, so counters inside a glyph stay open.
        let winding = 0;
        for (let index = 0; index < crossings.length - 1; index += 1) {
          winding += (crossings[index] as { direction: number }).direction;
          if (winding === 0) continue;
          const spanStart = (crossings[index] as { x: number }).x;
          const spanEnd = (crossings[index + 1] as { x: number }).x;
          const from = Math.max(0, Math.floor(spanStart));
          const to = Math.min(this.width - 1, Math.ceil(spanEnd));
          for (let column = from; column <= to; column += 1) {
            const overlap = Math.min(column + 1, spanEnd) - Math.max(column, spanStart);
            if (overlap <= 0) continue;
            coverage.set(column, (coverage.get(column) ?? 0) + overlap / samples);
          }
        }
      }
      for (const [column, alpha] of coverage) this.blend(column, row, colour, alpha);
    }
  }

  /** Draws text with its baseline at `y`, growing to the right from `x`. */
  drawText(font: TrueTypeFont, text: string, x: number, y: number, size: number, colour: Rgb): void {
    const scale = size / font.unitsPerEm;
    let penX = x;
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;
      const glyph = font.glyphFor(codePoint);
      const contours = font.contoursFor(glyph);
      if (contours.length > 0) {
        this.fillPolygons(
          contours.map((contour) =>
            contour.map(([glyphX, glyphY]) => [penX + glyphX * scale, y - glyphY * scale] as const),
          ),
          colour,
        );
      }
      penX += (font.widthFor(glyph) * size) / 1000;
    }
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** An 8-bit truecolour PNG; the only filter used is None, inside one FlateDecode stream. */
function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    rgb.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Breaks text into lines that fit `maxWidth` pixels in the given font and size. */
export function wrapForRaster(
  font: TrueTypeFont,
  text: string,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const measure = (value: string): number => (shape(font, value).width * size) / 1000;
  const words = text.split(/\s+/).filter((word) => word !== '');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth || current === '') {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) return lines;
  }
  if (current !== '' && lines.length < maxLines) lines.push(current);
  return lines;
}
