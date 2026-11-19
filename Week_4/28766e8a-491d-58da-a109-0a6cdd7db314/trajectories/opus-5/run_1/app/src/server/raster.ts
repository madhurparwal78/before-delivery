import { deflateSync } from 'node:zlib';
import { crc32 } from 'node:zlib';
import { type Page, type Point } from '../shared/document.js';
import { connectorLabelPoint } from '../shared/geometry.js';
import { type ViewBox, exportViewBox, shapesInDrawOrder } from './render.js';
import { shownConnectors } from '../shared/document.js';
import { GLYPH_CELL, glyphStrokes, textWidth } from './strokefont.js';

const INK: Colour = [27, 42, 74, 255];
const PAPER: Colour = [251, 248, 241, 255];

type Colour = readonly [number, number, number, number];

class Raster {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number, background: Colour) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    if (background[3] > 0) {
      for (let i = 0; i < width * height; i += 1) {
        this.pixels[i * 4] = background[0];
        this.pixels[i * 4 + 1] = background[1];
        this.pixels[i * 4 + 2] = background[2];
        this.pixels[i * 4 + 3] = background[3];
      }
    }
  }

  blend(x: number, y: number, colour: Colour, alpha: number): void {
    if (alpha <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const a = Math.min(1, alpha);
    const existing = (this.pixels[i + 3] ?? 0) / 255;
    const out = a + existing * (1 - a);
    for (let c = 0; c < 3; c += 1) {
      const source = colour[c] ?? 0;
      const target = this.pixels[i + c] ?? 0;
      this.pixels[i + c] = out === 0 ? 0 : (source * a + target * existing * (1 - a)) / out;
    }
    this.pixels[i + 3] = out * 255;
  }

  /** An antialiased thick line, drawn by distance from the segment. */
  line(ax: number, ay: number, bx: number, by: number, colour: Colour, thickness: number): void {
    const half = thickness / 2;
    const minX = Math.floor(Math.min(ax, bx) - half - 1);
    const maxX = Math.ceil(Math.max(ax, bx) + half + 1);
    const minY = Math.floor(Math.min(ay, by) - half - 1);
    const maxY = Math.ceil(Math.max(ay, by) + half + 1);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared));
        const distance = Math.hypot(px - dx * t, py - dy * t);
        this.blend(x, y, colour, Math.max(0, Math.min(1, half + 0.5 - distance)));
      }
    }
  }

  polyline(points: readonly Point[], colour: Colour, thickness: number): void {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a && b) this.line(a[0], a[1], b[0], b[1], colour, thickness);
    }
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.pixels);
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, checksum]);
}

/** A valid 8-bit RGBA PNG, written straight from the raster. */
function encodePng(width: number, height: number, pixels: Uint8ClampedArray): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawText(
  raster: Raster,
  text: string,
  centreX: number,
  centreY: number,
  fontSize: number,
  scale: number,
  view: ViewBox,
): void {
  const unit = (fontSize / GLYPH_CELL.height) * scale;
  const width = textWidth(text, fontSize) * scale;
  let penX = (centreX - view.x) * scale - width / 2;
  const top = (centreY - view.y) * scale - (GLYPH_CELL.height * unit) / 2;
  const thickness = Math.max(1, fontSize * scale * 0.09);
  for (const character of text) {
    for (const stroke of glyphStrokes(character)) {
      const points: Point[] = stroke.map(([x, y]) => [penX + x * unit, top + y * unit]);
      raster.polyline(points, INK, thickness);
    }
    penX += GLYPH_CELL.advance * unit;
  }
}

function ellipseOutline(cx: number, cy: number, rx: number, ry: number): Point[] {
  const steps = Math.max(24, Math.ceil((rx + ry) / 2));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/**
 * Renders the same snapshot the SVG export would: the page's visible shapes and shown
 * connectors, with their labels, and nothing else.
 */
export function renderPng(
  page: Page,
  scale: number,
  background: 'white' | 'transparent',
): { png: Buffer; width: number; height: number } {
  const view = exportViewBox(page);
  if (!view) throw new Error('A page with no visible shape cannot be exported');
  const width = Math.round(view.w * scale);
  const height = Math.round(view.h * scale);
  const raster = new Raster(width, height, background === 'white' ? PAPER : [0, 0, 0, 0]);
  const stroke = 1.5 * scale;
  const at = (point: Point): Point => [(point[0] - view.x) * scale, (point[1] - view.y) * scale];

  for (const shape of shapesInDrawOrder(page)) {
    const x1 = shape.x;
    const y1 = shape.y;
    const x2 = shape.x + shape.w;
    const y2 = shape.y + shape.h;
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    if (shape.kind === 'rectangle') {
      raster.polyline(
        [at([x1, y1]), at([x2, y1]), at([x2, y2]), at([x1, y2]), at([x1, y1])],
        INK,
        stroke,
      );
    } else if (shape.kind === 'diamond') {
      raster.polyline(
        [at([cx, y1]), at([x2, cy]), at([cx, y2]), at([x1, cy]), at([cx, y1])],
        INK,
        stroke,
      );
    } else if (shape.kind === 'ellipse') {
      raster.polyline(ellipseOutline(cx, cy, shape.w / 2, shape.h / 2).map(at), INK, stroke);
    }
    if (shape.label.length > 0) drawText(raster, shape.label, cx, cy, 14, scale, view);
  }

  for (const connector of shownConnectors(page)) {
    raster.polyline(connector.route.map(at), INK, stroke);
    if (connector.label.length > 0) {
      const point = connectorLabelPoint(connector.route);
      drawText(raster, connector.label, point[0], point[1], 12, scale, view);
    }
  }

  return { png: raster.toPng(), width, height };
}
