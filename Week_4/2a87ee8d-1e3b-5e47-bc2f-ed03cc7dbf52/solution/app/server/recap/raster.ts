// A small RGB rasteriser for the recap frame images: rectangles and anti-aliased glyph outlines, encoded as PNG.
import zlib from "node:zlib";
import type { PathCommand } from "fontkit";
import { face, glyphs, type Face } from "./fonts.js";
import type { Rgb } from "./pdf.js";

type Point = [number, number];

const SAMPLES = 4;

export class Raster {
  private pixels: Buffer;

  constructor(readonly width: number, readonly height: number, ground: Rgb) {
    this.pixels = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) this.pixels.set(ground, i * 3);
  }

  private blend(x: number, y: number, color: Rgb, alpha: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const i = (y * this.width + x) * 3;
    for (let c = 0; c < 3; c += 1) {
      const base = this.pixels[i + c] ?? 0;
      this.pixels[i + c] = Math.round(base + ((color[c] ?? 0) - base) * Math.min(1, alpha));
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: Rgb): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py += 1) for (let px = x0; px < x1; px += 1) this.blend(px, py, color, 1);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: Rgb, line = 1): void {
    this.fillRect(x, y, w, line, color);
    this.fillRect(x, y + h - line, w, line, color);
    this.fillRect(x, y, line, h, color);
    this.fillRect(x + w - line, y, line, h, color);
  }

  /** Fills closed polygons with the non-zero rule, anti-aliased by vertical sub-scanlines. */
  private fillPolygons(polygons: Point[][], color: Rgb) {
    const edges: [number, number, number, number, number][] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const poly of polygons) {
      for (let i = 0; i < poly.length; i += 1) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (!a || !b || a[1] === b[1]) continue;
        const dir = b[1] > a[1] ? 1 : -1;
        const [top, bottom] = dir === 1 ? [a, b] : [b, a];
        edges.push([top[0], top[1], bottom[0], bottom[1], dir]);
        minY = Math.min(minY, top[1]);
        maxY = Math.max(maxY, bottom[1]);
      }
    }
    if (!edges.length) return;
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.height - 1, Math.ceil(maxY));
    for (let py = y0; py <= y1; py += 1) {
      const coverage = new Map<number, number>();
      for (let s = 0; s < SAMPLES; s += 1) {
        const sy = py + (s + 0.5) / SAMPLES;
        const hits: [number, number][] = [];
        for (const [x0, ey0, x1, ey1, dir] of edges) {
          if (sy < ey0 || sy >= ey1) continue;
          hits.push([x0 + ((sy - ey0) / (ey1 - ey0)) * (x1 - x0), dir]);
        }
        hits.sort((p, q) => p[0] - q[0]);
        let winding = 0;
        for (let h = 0; h < hits.length - 1; h += 1) {
          winding += hits[h]?.[1] ?? 0;
          if (winding === 0) continue;
          const left = hits[h]?.[0] ?? 0;
          const right = hits[h + 1]?.[0] ?? 0;
          for (let px = Math.max(0, Math.floor(left)); px <= Math.min(this.width - 1, Math.floor(right)); px += 1) {
            const span = Math.min(px + 1, right) - Math.max(px, left);
            if (span > 0) coverage.set(px, (coverage.get(px) ?? 0) + span / SAMPLES);
          }
        }
      }
      for (const [px, alpha] of coverage) this.blend(px, py, color, alpha);
    }
  }

  /** Draws text with its baseline at (x, y). */
  text(value: string, x: number, y: number, size: number, name: Face, color: Rgb): void {
    const { font } = face(name);
    const scale = size / font.unitsPerEm;
    let pen = x;
    const polygons: Point[][] = [];
    for (const glyph of glyphs(name, value)) {
      let current: Point[] = [];
      let last: Point = [0, 0];
      const at = (gx: number, gy: number): Point => [pen + gx * scale, y - gy * scale];
      for (const cmd of glyph.path.commands as PathCommand[]) {
        const a = cmd.args;
        if (cmd.command === "moveTo") {
          if (current.length) polygons.push(current);
          last = at(a[0] ?? 0, a[1] ?? 0);
          current = [last];
        } else if (cmd.command === "lineTo") {
          last = at(a[0] ?? 0, a[1] ?? 0);
          current.push(last);
        } else if (cmd.command === "quadraticCurveTo") {
          const c = at(a[0] ?? 0, a[1] ?? 0);
          const end = at(a[2] ?? 0, a[3] ?? 0);
          for (let i = 1; i <= 6; i += 1) {
            const t = i / 6;
            const u = 1 - t;
            current.push([u * u * last[0] + 2 * u * t * c[0] + t * t * end[0], u * u * last[1] + 2 * u * t * c[1] + t * t * end[1]]);
          }
          last = end;
        } else if (cmd.command === "bezierCurveTo") {
          const c1 = at(a[0] ?? 0, a[1] ?? 0);
          const c2 = at(a[2] ?? 0, a[3] ?? 0);
          const end = at(a[4] ?? 0, a[5] ?? 0);
          for (let i = 1; i <= 8; i += 1) {
            const t = i / 8;
            const u = 1 - t;
            current.push([
              u * u * u * last[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
              u * u * u * last[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
            ]);
          }
          last = end;
        } else if (current.length) {
          polygons.push(current);
          current = [];
        }
      }
      if (current.length) polygons.push(current);
      pen += glyph.advanceWidth * scale;
    }
    this.fillPolygons(polygons, color);
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      raw[y * (this.width * 3 + 1)] = 0;
      this.pixels.copy(raw, y * (this.width * 3 + 1) + 1, y * this.width * 3, (y + 1) * this.width * 3);
    }
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "latin1");
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
      return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}
