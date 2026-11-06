// Runs in a worker thread: decodes originals, renders the three JPEG derivatives (re-encoded, so no EXIF or
// GPS survives) and draws the seeded halftone frames. Pure JavaScript codecs: jpeg-js and pngjs.
import { parentPort } from "node:worker_threads";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { drawHalftone } from "./halftone.js";

export interface Raster {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export interface Derivatives {
  width: number;
  height: number;
  grid: Uint8Array;
  story: Uint8Array;
  preview: Uint8Array;
}

export type ImageJob =
  | { id: number; kind: "derive"; bytes: Uint8Array; type: "image/jpeg" | "image/png" }
  | { id: number; kind: "seed"; essayId: string; position: number; width: number; height: number };

export type ImageResult =
  | { id: number; ok: true; derivatives: Derivatives; original?: Uint8Array }
  | { id: number; ok: false };

const QUALITY = 84;

function decode(bytes: Uint8Array, type: "image/jpeg" | "image/png"): Raster {
  if (type === "image/png") {
    const png = PNG.sync.read(Buffer.from(bytes));
    const data = new Uint8Array(png.data);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = (data[i + 3] ?? 255) / 255;
      for (let c = 0; c < 3; c += 1) data[i + c] = Math.round((data[i + c] ?? 0) * alpha + 255 * (1 - alpha));
      data[i + 3] = 255;
    }
    return { width: png.width, height: png.height, data };
  }
  const image = jpeg.decode(Buffer.from(bytes), {
    useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1536, maxResolutionInMP: 250,
  });
  if (!image.width || !image.height) throw new Error("empty image");
  return { width: image.width, height: image.height, data: image.data };
}

/** Resamples the source rectangle (sx, sy, sw, sh) to dw×dh: box average when shrinking, bilinear when growing. */
function resample(src: Raster, sx: number, sy: number, sw: number, sh: number, dw: number, dh: number): Raster {
  const out = new Uint8Array(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const o = (y * dw + x) * 4;
      if (fx > 1 || fy > 1) {
        const x0 = Math.floor(sx + x * fx);
        const x1 = Math.max(x0 + 1, Math.min(src.width, Math.floor(sx + (x + 1) * fx)));
        const y0 = Math.floor(sy + y * fy);
        const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor(sy + (y + 1) * fy)));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1; yy += 1) {
          for (let xx = x0; xx < x1; xx += 1) {
            const i = (yy * src.width + xx) * 4;
            r += src.data[i] ?? 0;
            g += src.data[i + 1] ?? 0;
            b += src.data[i + 2] ?? 0;
            n += 1;
          }
        }
        out[o] = r / n;
        out[o + 1] = g / n;
        out[o + 2] = b / n;
      } else {
        const u = Math.min(src.width - 1, Math.max(0, sx + (x + 0.5) * fx - 0.5));
        const v = Math.min(src.height - 1, Math.max(0, sy + (y + 0.5) * fy - 0.5));
        const x0 = Math.floor(u), y0 = Math.floor(v);
        const x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1);
        const ax = u - x0, ay = v - y0;
        for (let c = 0; c < 3; c += 1) {
          const p = (xx: number, yy: number): number => src.data[(yy * src.width + xx) * 4 + c] ?? 0;
          out[o + c] = (p(x0, y0) * (1 - ax) + p(x1, y0) * ax) * (1 - ay) + (p(x0, y1) * (1 - ax) + p(x1, y1) * ax) * ay;
        }
      }
      out[o + 3] = 255;
    }
  }
  return { width: dw, height: dh, data: out };
}

function longestEdge(src: Raster, edge: number): Raster {
  const scale = edge / Math.max(src.width, src.height);
  return resample(src, 0, 0, src.width, src.height,
    Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
}

function centreSquare(src: Raster, side: number): Raster {
  const size = Math.min(src.width, src.height);
  return resample(src, Math.floor((src.width - size) / 2), Math.floor((src.height - size) / 2), size, size, side, side);
}

// Stroke glyphs on a 4×6 grid for the diagonal "SALTPRINT PREVIEW" watermark.
const GLYPHS: Record<string, number[][]> = {
  S: [[4, 0, 0, 0, 0, 3, 4, 3, 4, 6, 0, 6]],
  A: [[0, 6, 2, 0, 4, 6], [1, 3.6, 3, 3.6]],
  L: [[0, 0, 0, 6, 4, 6]],
  T: [[0, 0, 4, 0], [2, 0, 2, 6]],
  P: [[0, 6, 0, 0, 4, 0, 4, 3, 0, 3]],
  R: [[0, 6, 0, 0, 4, 0, 4, 3, 0, 3], [1.6, 3, 4, 6]],
  I: [[2, 0, 2, 6], [1, 0, 3, 0], [1, 6, 3, 6]],
  N: [[0, 6, 0, 0, 4, 6, 4, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  V: [[0, 0, 2, 6, 4, 0]],
  W: [[0, 0, 1, 6, 2, 2.4, 3, 6, 4, 0]],
};

function watermark(img: Raster, text: string): void {
  const { width, height, data } = img;
  const unit = Math.min(width, height) / 66;
  const advance = 5.6 * unit;
  const textWidth = [...text].reduce((w, ch) => w + (ch === " " ? 3 * unit : advance), 0) - 1.6 * unit;
  const angle = -Math.atan2(height, width);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const mask = new Float32Array(width * height);
  const radius = Math.max(1.2, unit * 0.42);
  const stamp = (px: number, py: number): void => {
    const r = Math.ceil(radius + 1);
    for (let y = Math.max(0, Math.floor(py - r)); y <= Math.min(height - 1, Math.ceil(py + r)); y += 1) {
      for (let x = Math.max(0, Math.floor(px - r)); x <= Math.min(width - 1, Math.ceil(px + r)); x += 1) {
        const d = Math.hypot(x - px, y - py);
        const cover = Math.min(1, Math.max(0, radius + 0.5 - d));
        const i = y * width + x;
        if (cover > (mask[i] ?? 0)) mask[i] = cover;
      }
    }
  };
  const place = (u: number, v: number): [number, number] =>
    [width / 2 + u * cos - v * sin, height / 2 + u * sin + v * cos];
  let cursor = -textWidth / 2;
  for (const ch of text) {
    if (ch === " ") {
      cursor += 3 * unit;
      continue;
    }
    for (const line of GLYPHS[ch] ?? []) {
      for (let k = 0; k + 3 < line.length; k += 2) {
        const [ax, ay] = place(cursor + (line[k] ?? 0) * unit, ((line[k + 1] ?? 0) - 3) * unit);
        const [bx, by] = place(cursor + (line[k + 2] ?? 0) * unit, ((line[k + 3] ?? 0) - 3) * unit);
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (radius * 0.5)));
        for (let s = 0; s <= steps; s += 1) stamp(ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps);
      }
    }
    cursor += advance;
  }
  for (let i = 0; i < mask.length; i += 1) {
    const m = mask[i] ?? 0;
    if (m === 0) continue;
    const o = i * 4;
    const lum = 0.3 * (data[o] ?? 0) + 0.59 * (data[o + 1] ?? 0) + 0.11 * (data[o + 2] ?? 0);
    const ink = lum > 150 ? 30 : 245; // dark letters on light frames, light letters on dark ones
    const alpha = 0.5 * m;
    for (let c = 0; c < 3; c += 1) data[o + c] = Math.round((data[o + c] ?? 0) * (1 - alpha) + ink * alpha);
  }
}

const encode = (img: Raster): Uint8Array =>
  new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, QUALITY).data);

function derive(src: Raster): Derivatives {
  const preview = longestEdge(src, 1200);
  watermark(preview, "SALTPRINT PREVIEW");
  return {
    width: src.width, height: src.height,
    grid: encode(centreSquare(src, 600)), story: encode(longestEdge(src, 1600)), preview: encode(preview),
  };
}

function run(job: ImageJob): ImageResult {
  try {
    if (job.kind === "derive") return { id: job.id, ok: true, derivatives: derive(decode(job.bytes, job.type)) };
    const raster = drawHalftone(job.essayId, job.position, job.width, job.height);
    return { id: job.id, ok: true, derivatives: derive(raster), original: encode(raster) };
  } catch {
    return { id: job.id, ok: false };
  }
}

parentPort?.on("message", (job: ImageJob) => {
  const result = run(job);
  const transfer = result.ok
    ? [result.derivatives.grid.buffer, result.derivatives.story.buffer, result.derivatives.preview.buffer,
      ...(result.original ? [result.original.buffer] : [])] as ArrayBuffer[]
    : [];
  parentPort?.postMessage(result, transfer);
});
