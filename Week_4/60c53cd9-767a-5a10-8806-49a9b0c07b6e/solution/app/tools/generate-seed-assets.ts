/**
 * Deterministic seed-asset generator for the Highwater Unit Finder.
 *
 * Writes, under assets/seed/:
 *   models/tower-shell.glb, models/plates/<band>.glb   (Draco-compressed, KHR_draco_mesh_compression required)
 *   textures/facade.png, textures/duotone-ramp.png     (exactly two colours each)
 *   views/bands/<band>/<stack>.png                     (procedural 1536x512 skyline photographs)
 *   MANIFEST.json                                      (path, sha256, bytes for every generated file)
 *
 * Everything is derived from seeded PRNGs, so reruns are byte-identical. Run with `npm run assets`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { Document, NodeIO, type Buffer as GltfBuffer } from "@gltf-transform/core";
import { KHRDracoMeshCompression } from "@gltf-transform/extensions";
import {
  APOTHEM,
  PODIUM_HEIGHT,
  PODIUM_SCALE,
  STOREY_HEIGHT,
  TOWER_HEIGHT,
  faceCorners,
  normalOf,
  planVertices,
} from "../src/shared/tower-geometry.js";
import { BANDS, BAND_FLOORS, STACKS, STACK_LETTERS, type Band, type StackLetter, type ViewTag } from "../src/shared/domain.js";

// ---------------------------------------------------------------------------------------------------------------
// Paths and file bookkeeping
// ---------------------------------------------------------------------------------------------------------------

const SEED_ROOT = fileURLToPath(new URL("../assets/seed/", import.meta.url));

interface GeneratedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}
const generated: GeneratedFile[] = [];

const emit = (relativePath: string, bytes: Uint8Array): void => {
  const target = join(SEED_ROOT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  generated.push({ path: relativePath, bytes });
};

// ---------------------------------------------------------------------------------------------------------------
// PNG encoder (colour type 2, 8-bit, per-row adaptive filters)
// ---------------------------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

const encodePng = (width: number, height: number, rgb: Uint8Array): Uint8Array => {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  const zero = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const prior = y === 0 ? zero : rgb.subarray((y - 1) * stride, y * stride);
    for (let i = 0; i < stride; i += 1) {
      const x = row[i] as number;
      const left = i >= 3 ? (row[i - 3] as number) : 0;
      const up = prior[i] as number;
      const upLeft = i >= 3 ? (prior[i - 3] as number) : 0;
      (candidates[0] as Uint8Array)[i] = x;
      (candidates[1] as Uint8Array)[i] = (x - left) & 0xff;
      (candidates[2] as Uint8Array)[i] = (x - up) & 0xff;
      (candidates[3] as Uint8Array)[i] = (x - ((left + up) >> 1)) & 0xff;
      (candidates[4] as Uint8Array)[i] = (x - paeth(left, up, upLeft)) & 0xff;
    }
    let best = 0;
    let bestScore = Infinity;
    candidates.forEach((candidate, filter) => {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const v = candidate[i] as number;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = filter;
      }
    });
    raw[y * (stride + 1)] = best;
    raw.set(candidates[best] as Uint8Array, y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9, memLevel: 9 }))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------
// Seeded randomness, noise and colour helpers
// ---------------------------------------------------------------------------------------------------------------

const hashString = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }
  /** Roughly gaussian, mean 0, spread about 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
}

const hash2 = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const noise2 = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

const fbm = (x: number, y: number, seed: number, octaves: number): number => {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * noise2(x * freq, y * freq, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
};

type RGB = readonly [number, number, number];
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scaleRgb = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const mulRgb = (a: RGB, b: RGB): RGB => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------------------------
// Tiny software rasteriser
// ---------------------------------------------------------------------------------------------------------------

type Pt = readonly [number, number];

class Canvas {
  readonly data: Float32Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Float32Array(width * height * 3);
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }

  get(x: number, y: number): RGB {
    const cx = Math.min(this.width - 1, Math.max(0, x));
    const cy = Math.min(this.height - 1, Math.max(0, y));
    const i = (cy * this.width + cx) * 3;
    return [this.data[i] as number, this.data[i + 1] as number, this.data[i + 2] as number];
  }

  blend(x: number, y: number, c: RGB, a: number): void {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    const d = this.data;
    d[i] = (d[i] as number) + (c[0] - (d[i] as number)) * a;
    d[i + 1] = (d[i + 1] as number) + (c[1] - (d[i + 1] as number)) * a;
    d[i + 2] = (d[i + 2] as number) + (c[2] - (d[i + 2] as number)) * a;
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
    const xa = Math.max(0, Math.round(Math.min(x0, x1)));
    const xb = Math.min(this.width, Math.round(Math.max(x0, x1)));
    const ya = Math.max(0, Math.round(Math.min(y0, y1)));
    const yb = Math.min(this.height, Math.round(Math.max(y0, y1)));
    for (let y = ya; y < yb; y += 1) for (let x = xa; x < xb; x += 1) this.blend(x, y, c, a);
  }

  /** Scanline polygon fill with horizontal edge coverage; colour may vary per pixel. */
  poly(points: readonly Pt[], colour: RGB | ((x: number, y: number) => RGB), a = 1): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.height - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = y0; y <= y1; y += 1) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i] as Pt;
        const q = points[(i + 1) % points.length] as Pt;
        if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) {
          xs.push(p[0] + ((yc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
        }
      }
      xs.sort((m, n) => m - n);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k] as number;
        const xb = xs[k + 1] as number;
        for (let x = Math.max(0, Math.floor(xa)); x <= Math.min(this.width - 1, Math.floor(xb)); x += 1) {
          const cover = Math.min(x + 1, xb) - Math.max(x, xa);
          if (cover <= 0) continue;
          this.blend(x, y, typeof colour === "function" ? colour(x, y) : colour, a * Math.min(1, cover));
        }
      }
    }
  }

  quad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: RGB, a = 1): void {
    this.poly(
      [
        [x0, y0],
        [x1, y1],
        [x2, y2],
        [x3, y3],
      ],
      c,
      a,
    );
  }

  disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        this.blend(x, y, c, clamp01(r + 0.5 - d) * a);
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + ry + 1));
    const soft = Math.min(rx, ry);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
        this.blend(x, y, c, clamp01((1 - d) * soft + 0.5) * a);
      }
    }
  }

  /** Fill from a per-column top edge down to `bottom`, colour a function of (x, y). */
  columns(x0: number, x1: number, top: (x: number) => number, bottom: number, colour: (x: number, y: number) => RGB, a = 1): void {
    for (let x = Math.max(0, x0); x < Math.min(this.width, x1); x += 1) {
      const t = top(x);
      const yStart = Math.floor(t);
      for (let y = Math.max(0, yStart); y < Math.min(this.height, bottom); y += 1) {
        const cover = y === yStart ? 1 - (t - yStart) : 1;
        this.blend(x, y, colour(x, y), cover * a);
      }
    }
  }

  vgrad(y0: number, y1: number, c0: RGB, c1: RGB, a = 1): void {
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y += 1) {
      const c = mix(c0, c1, (y - y0) / Math.max(1, y1 - y0));
      for (let x = 0; x < this.width; x += 1) this.blend(x, y, c, a);
    }
  }

  toRgb8(seed: number): Uint8Array {
    const out = new Uint8Array(this.width * this.height * 3);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const nx = (x / this.width - 0.5) * 2;
        const ny = (y / this.height - 0.5) * 2;
        const vignette = 1 - 0.16 * Math.pow(Math.min(1.4, Math.hypot(nx * 0.8, ny * 0.9)), 2.2);
        const grain = hash2(x, y, seed);
        const jitter = grain < 0.012 ? -1 : grain > 0.988 ? 1 : 0;
        for (let k = 0; k < 3; k += 1) {
          const v = (this.data[(y * this.width + x) * 3 + k] as number) * vignette + jitter;
          // Two-level steps keep the files small; the sparse grain above hides any banding.
          out[(y * this.width + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(v / 2) * 2));
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Skyline photographs
// ---------------------------------------------------------------------------------------------------------------

const VIEW_W = 1536;
const VIEW_H = 512;

interface Mood {
  readonly top: RGB;
  readonly horizon: RGB;
  readonly sun: RGB;
  readonly sunX: number;
  readonly sunElev: number;
  readonly tone: RGB;
  readonly clouds: number;
  readonly cloudLit: RGB;
  readonly cloudShade: RGB;
  readonly deepWater: RGB;
  readonly sunDisc: boolean;
}

/** Time-of-day tint per stack, so neighbouring stacks never share a sky. */
const MOODS: Readonly<Record<StackLetter, Mood>> = {
  A: { top: [84, 138, 205], horizon: [252, 216, 160], sun: [255, 232, 176], sunX: 0.72, sunElev: 0.34, tone: [1.08, 1.0, 0.86], clouds: 0.5, cloudLit: [255, 236, 206], cloudShade: [170, 160, 176], deepWater: [20, 72, 96], sunDisc: true },
  B: { top: [36, 106, 204], horizon: [176, 212, 244], sun: [255, 252, 236], sunX: 0.3, sunElev: 0.62, tone: [1.0, 1.0, 1.02], clouds: 0.35, cloudLit: [255, 255, 255], cloudShade: [160, 178, 206], deepWater: [14, 70, 108], sunDisc: true },
  C: { top: [66, 118, 192], horizon: [255, 206, 142], sun: [255, 214, 150], sunX: 0.62, sunElev: 0.22, tone: [1.1, 0.97, 0.8], clouds: 0.55, cloudLit: [255, 222, 186], cloudShade: [150, 140, 172], deepWater: [18, 66, 92], sunDisc: true },
  D: { top: [52, 66, 140], horizon: [255, 150, 100], sun: [255, 176, 96], sunX: 0.44, sunElev: 0.09, tone: [1.1, 0.84, 0.78], clouds: 0.6, cloudLit: [255, 170, 130], cloudShade: [92, 84, 140], deepWater: [20, 44, 82], sunDisc: true },
  E: { top: [64, 96, 168], horizon: [240, 192, 196], sun: [255, 214, 200], sunX: 0.2, sunElev: 0.12, tone: [1.0, 0.94, 1.02], clouds: 0.5, cloudLit: [255, 214, 214], cloudShade: [128, 128, 176], deepWater: [26, 62, 92], sunDisc: true },
  F: { top: [118, 138, 166], horizon: [208, 214, 222], sun: [236, 238, 240], sunX: 0.5, sunElev: 0.45, tone: [0.96, 0.98, 1.0], clouds: 0.9, cloudLit: [226, 230, 236], cloudShade: [134, 146, 164], deepWater: [34, 72, 96], sunDisc: false },
  G: { top: [46, 46, 118], horizon: [240, 128, 140], sun: [255, 140, 132], sunX: 0.8, sunElev: 0.07, tone: [1.04, 0.78, 0.9], clouds: 0.55, cloudLit: [255, 150, 160], cloudShade: [82, 70, 140], deepWater: [22, 38, 82], sunDisc: true },
  H: { top: [98, 150, 208], horizon: [255, 226, 186], sun: [255, 238, 200], sunX: 0.1, sunElev: 0.2, tone: [1.06, 1.0, 0.9], clouds: 0.4, cloudLit: [255, 240, 220], cloudShade: [176, 176, 196], deepWater: [20, 78, 104], sunDisc: true },
};

const HORIZON_FRACTION: Readonly<Record<string, number>> = { "03-09": 0.42, "10-19": 0.49, "20-29": 0.55, "30-35": 0.6 };

interface Scene {
  readonly cv: Canvas;
  readonly rng: Rng;
  readonly mood: Mood;
  readonly hor: number;
  readonly bandIndex: number;
  readonly seed: number;
  readonly stack: StackLetter;
}

const paintSky = (s: Scene): void => {
  const { cv, mood, hor, seed } = s;
  const sx = mood.sunX * VIEW_W;
  const sy = hor - mood.sunElev * hor;
  const offX = (seed % 997) * 0.37;
  const offY = (seed % 463) * 0.21;
  for (let y = 0; y < hor + 8; y += 1) {
    const t = Math.min(1, y / hor);
    const base = mix(mood.top, mood.horizon, Math.pow(t, 1.5));
    for (let x = 0; x < VIEW_W; x += 1) {
      const dx = x - sx;
      const dy = y - sy;
      const d2 = dx * dx + dy * dy;
      const glow = Math.exp(-d2 / (2 * 190 * 190)) * 0.5 + Math.exp(-d2 / (2 * 46 * 46)) * 0.5;
      let c = mix(base, mood.sun, clamp01(glow * (mood.sunDisc ? 0.75 : 0.25)));
      if (mood.clouds > 0 && t < 0.97) {
        const n = fbm(x * 0.0034 + offX, y * 0.0125 + offY, seed, 5);
        const density = smoothstep(0.56 - 0.22 * mood.clouds, 0.78 - 0.12 * mood.clouds, n) * (1 - Math.pow(t, 3) * 0.75) * smoothstep(0, 0.06, t + 0.05);
        if (density > 0.002) {
          const shade = fbm(x * 0.0034 + offX + 0.012, y * 0.0125 + offY + 0.03, seed, 5);
          const lit = clamp01(0.55 + (n - shade) * 9);
          const sunTint = clamp01(glow * 1.3);
          const cloud = mix(mix(mood.cloudShade, mood.cloudLit, lit), mood.sun, sunTint * 0.35);
          c = mix(c, cloud, density * 0.88);
        }
      }
      cv.set(x, y, c);
    }
  }
  if (mood.sunDisc && sy < hor - 3) {
    cv.disc(sx, sy, 22, mix(mood.sun, [255, 255, 255], 0.5), 0.35);
    cv.disc(sx, sy, 13, mix(mood.sun, [255, 255, 255], 0.85), 1);
  }
};

const paintWater = (s: Scene): void => {
  const { cv, rng, mood, hor, seed } = s;
  const span = VIEW_H - hor;
  for (let y = hor; y < VIEW_H; y += 1) {
    const t = (y - hor + 0.5) / span;
    const persp = 1 / (0.04 + t);
    const refl = mix(mood.horizon, mood.top, clamp01(t * 0.9));
    const base = mix(scaleRgb(refl, 0.94), mood.deepWater, smoothstep(0, 0.6, t));
    for (let x = 0; x < VIEW_W; x += 1) {
      const n = noise2((x * 0.01) / (0.35 + t * 0.9), persp * 0.9, seed + 7);
      const n2 = noise2((x * 0.03) / (0.3 + t), persp * 2.7, seed + 8);
      const m = 1 + (n - 0.5) * 0.3 * (0.25 + t) + (n2 - 0.5) * 0.12 * (0.25 + t);
      cv.set(x, y, scaleRgb(base, m));
    }
  }
  const sx = mood.sunX * VIEW_W;
  const streakCount = 2200;
  for (let i = 0; i < streakCount; i += 1) {
    const t = Math.pow(rng.next(), 1.35);
    const y = Math.round(hor + 2 + t * (span - 3));
    const persp = 0.25 + 2.4 * t;
    const length = (5 + rng.next() * 26) * persp;
    const thick = Math.max(1, Math.round(0.9 * persp));
    const nearSun = rng.chance(mood.sunDisc ? 0.62 : 0.15);
    const x = nearSun ? sx + rng.gauss() * (26 + 210 * t) : rng.next() * VIEW_W;
    const glint = mix(mood.sun, [255, 255, 255], 0.55);
    if (nearSun) cv.rect(x - length / 2, y, x + length / 2, y + thick, glint, 0.2 + rng.next() * 0.35);
    else if (rng.chance(0.55)) cv.rect(x - length / 2, y, x + length / 2, y + thick, mix(mood.horizon, [255, 255, 255], 0.5), 0.08 + rng.next() * 0.14);
    else cv.rect(x - length / 2, y, x + length / 2, y + thick, scaleRgb(mood.deepWater, 0.55), 0.1 + rng.next() * 0.14);
  }
  cv.vgrad(hor - 4, hor + 6, mood.horizon, mood.horizon, 0.0);
  for (let y = hor - 3; y < hor + 5; y += 1) {
    const a = 0.22 * (1 - Math.abs(y - hor - 0.5) / 5);
    for (let x = 0; x < VIEW_W; x += 1) cv.blend(x, y, mood.horizon, a);
  }
};

const paintHeadland = (s: Scene): void => {
  const { cv, rng, mood, hor, seed } = s;
  const leftSide = rng.chance(0.5);
  const layers: ReadonlyArray<{ width: number; height: number; haze: number; offset: number }> = [
    { width: rng.range(0.34, 0.5), height: rng.range(26, 40), haze: 0.62, offset: 0 },
    { width: rng.range(0.2, 0.3), height: rng.range(16, 26), haze: 0.42, offset: rng.range(0.02, 0.1) },
  ];
  for (const layer of layers) {
    const w = layer.width * VIEW_W;
    const x0 = leftSide ? -10 - layer.offset * VIEW_W * 0.2 : VIEW_W - w + 10 + layer.offset * VIEW_W * 0.2;
    const x1 = x0 + w;
    const rock = mix([54, 92, 96], [78, 96, 74], rng.next());
    const col = mulRgb(mix(rock, mood.horizon, layer.haze), [lerp(1, mood.tone[0], 0.5), lerp(1, mood.tone[1], 0.5), lerp(1, mood.tone[2], 0.5)]);
    const hgt = layer.height * (1.2 - s.bandIndex * 0.1);
    cv.columns(
      x0,
      x1,
      (x) => {
        const u = clamp01((x - x0) / (x1 - x0));
        const edge = leftSide ? Math.pow(1 - u, 0.7) : Math.pow(u, 0.7);
        const bump = Math.pow(Math.sin(Math.PI * clamp01(leftSide ? 1 - u : u)), 0.5);
        return hor - hgt * edge * (0.65 + 0.7 * fbm(x * 0.012, 3.1, seed + 40, 4)) * (0.5 + 0.5 * bump) - 1;
      },
      hor + 2,
      (_x, y) => mix(col, mood.horizon, clamp01((y - (hor - hgt)) / (hgt + 4)) * 0.55),
    );
    for (let i = 0; i < 9; i += 1) {
      const bx = rng.range(Math.min(x0, x1) + 20, Math.max(x0, x1) - 20);
      cv.rect(bx, hor - rng.range(2, 8), bx + rng.range(2, 4), hor - 1, mix([240, 236, 228], mood.horizon, 0.5), 0.55);
    }
  }
};

const paintSails = (s: Scene): void => {
  const { cv, rng, mood, hor } = s;
  const count = rng.int(2, 3);
  for (let i = 0; i < count; i += 1) {
    const y = hor + rng.range(8, 46);
    const size = 10 + (y - hor) * 0.9;
    const x = rng.range(0.1, 0.9) * VIEW_W;
    const lean = rng.range(-0.15, 0.15);
    const white = mulRgb([250, 250, 246], mood.tone);
    const shade = mulRgb([200, 204, 214], mood.tone);
    cv.rect(x - size * 0.55, y - size * 0.1, x + size * 0.6, y + size * 0.03, [38, 44, 58], 0.95);
    cv.poly([[x, y - size * 1.25], [x + size * 0.5 + lean * size, y - size * 0.16], [x, y - size * 0.16]], white);
    cv.poly([[x - size * 0.06, y - size * 1.05], [x - size * 0.06, y - size * 0.16], [x - size * 0.55, y - size * 0.16]], shade);
    cv.rect(x - size * 0.6, y + size * 0.05, x + size * 0.6, y + size * 0.14, mix(white, mood.deepWater, 0.4), 0.25);
  }
};

const paintHarbour = (s: Scene): void => {
  paintSky(s);
  paintHeadland(s);
  paintWater(s);
  paintSails(s);
};

/** An invented 24-storey residential block ("Calder House") filling about half the frame on one side. */
const paintCalderHouse = (s: Scene): void => {
  const { cv, rng, mood, hor } = s;
  const left = rng.chance(0.5);
  const mx = (x: number): number => (left ? x : VIEW_W - x);
  const coverage = s.bandIndex === 0 ? 0.53 : 0.46;
  const sideW = VIEW_W * rng.range(0.085, 0.115);
  const frontW = VIEW_W * coverage - sideW;
  const xs = frontW;
  const xf = frontW + sideW;
  const k = 0.6;
  const nearTop = -24;
  const nearBottom = VIEW_H + 24;
  const farTop = hor - (hor - nearTop) * k;
  const farBottom = hor + (nearBottom - hor) * k;

  const brick = mulRgb(mix([104, 62, 54], [86, 80, 84], rng.range(0.15, 0.5)), mood.tone);
  const pier = mulRgb([88, 88, 94], mood.tone);
  const ledge = mulRgb([142, 138, 134], mood.tone);

  cv.poly([[mx(0), nearTop], [mx(xs), nearTop], [mx(xs), nearBottom], [mx(0), nearBottom]], (x, y) => {
    const shade = 1 - 0.28 * (y / VIEW_H) + (hash2(x >> 1, y >> 1, s.seed) - 0.5) * 0.035;
    return scaleRgb(brick, shade);
  });

  const columns = 17;
  const colPitch = frontW / columns;
  const rowPitch = 25;
  const winW = colPitch * 0.56;
  const winH = 15;
  const phase = rng.range(0, rowPitch);
  const litChance = mood.sunElev < 0.2 ? 0.46 : 0.26;
  const skyRefl = (y: number): RGB => mix([44, 58, 84], mood.horizon, 0.22 + 0.26 * (1 - y / VIEW_H));
  for (let r = -1; r * rowPitch + phase < VIEW_H + rowPitch; r += 1) {
    const y0 = r * rowPitch + phase;
    cv.rect(mx(0), y0 + winH + 3, mx(xs), y0 + winH + 5, ledge, 0.6);
    for (let c = 0; c < columns; c += 1) {
      const cx0 = c * colPitch + (colPitch - winW) / 2;
      if (c % 4 === 0) cv.rect(mx(c * colPitch), y0 - 6, mx(c * colPitch + colPitch * 0.16), y0 + rowPitch - 6, pier, 0.5);
      const lit = hash2(c, r, s.seed + 5) < litChance;
      const colour = lit ? mix([255, 208, 120], [255, 232, 170], hash2(c, r, s.seed + 6)) : skyRefl(y0);
      cv.rect(mx(cx0), y0, mx(cx0 + winW), y0 + winH, colour, 1);
      if (!lit) cv.rect(mx(cx0), y0, mx(cx0 + winW), y0 + 3, mix(mood.horizon, [255, 255, 255], 0.4), 0.35);
    }
  }

  const wallSide = scaleRgb(brick, 0.6);
  const sideShade = (x: number, y: number): RGB => scaleRgb(wallSide, 1 - 0.28 * (y / VIEW_H) - (x < 0 ? 0 : 0));
  cv.poly([[mx(xs), nearTop], [mx(xf), farTop], [mx(xf), farBottom], [mx(xs), nearBottom]], sideShade);
  const depth = 2.2;
  const project = (u: number): number => (1 - 1 / (1 + u * depth)) / (1 - 1 / (1 + depth));
  const sideCols = 6;
  for (let c = 0; c < sideCols; c += 1) {
    const u0 = project((c + 0.2) / sideCols);
    const u1 = project((c + 0.78) / sideCols);
    const xa = lerp(xs, xf, u0);
    const xb = lerp(xs, xf, u1);
    const topA = lerp(nearTop, farTop, u0);
    const topB = lerp(nearTop, farTop, u1);
    const botA = lerp(nearBottom, farBottom, u0);
    const botB = lerp(nearBottom, farBottom, u1);
    const heightA = botA - topA;
    const heightB = botB - topB;
    const rows = 24;
    for (let r = 0; r < rows; r += 1) {
      const v0 = (r + 0.3) / rows;
      const v1 = (r + 0.7) / rows;
      const lit = hash2(c, r + 100, s.seed + 9) < litChance;
      const colour = lit ? [236, 186, 106] as RGB : scaleRgb(skyRefl(topA + heightA * v0), 0.55);
      cv.quad(mx(xa), topA + heightA * v0, mx(xb), topB + heightB * v0, mx(xb), topB + heightB * v1, mx(xa), topA + heightA * v1, colour, 1);
    }
  }
  // Roof parapet catching the light along the slanted top edge.
  cv.poly([[mx(0), nearTop], [mx(xs), nearTop], [mx(xf), farTop], [mx(xf), farTop + 3], [mx(xs), nearTop + 3], [mx(0), nearTop + 3]], mix(ledge, mood.horizon, 0.3), 0.8);
  // Edge highlight where the two faces meet.
  cv.rect(mx(xs) - 1, 0, mx(xs) + 1, VIEW_H, mix(ledge, mood.horizon, 0.4), 0.45);
};

const GREENS: readonly RGB[] = [
  [52, 104, 46],
  [74, 130, 54],
  [38, 84, 52],
  [96, 146, 62],
  [60, 116, 70],
  [112, 150, 58],
  [30, 70, 48],
];
const AUTUMN: readonly RGB[] = [
  [196, 128, 40],
  [176, 84, 36],
  [214, 164, 56],
];

const paintPark = (s: Scene): void => {
  const { cv, rng, mood, hor, seed, stack } = s;
  paintSky(s);
  const autumn = stack === "A";
  // Distant hills and low buildings.
  cv.columns(0, VIEW_W, (x) => hor - 10 - 22 * fbm(x * 0.004, 9.5, seed + 12, 4), hor + 4, (_x, y) => mix(mixToward(mood, [96, 128, 120], 0.55), mood.horizon, clamp01((y - (hor - 30)) / 34) * 0.6));
  for (let i = 0; i < 34; i += 1) {
    const w = rng.range(8, 26);
    const h = rng.range(6, 24);
    const x = rng.range(0, VIEW_W);
    cv.rect(x, hor - h, x + w, hor + 2, mix(mulRgb(rng.pick<RGB>([[200, 190, 180], [170, 176, 188], [196, 170, 150]]), mood.tone), mood.horizon, 0.5), 0.9);
  }
  // Lawn with perspective mow stripes.
  const span = VIEW_H - hor;
  for (let y = hor; y < VIEW_H; y += 1) {
    const t = (y - hor) / span;
    const far = mix([96, 142, 96], mood.horizon, 0.45);
    const near = mulRgb([54, 118, 46], mood.tone);
    const c = mix(far, near, Math.pow(t, 0.7));
    for (let x = 0; x < VIEW_W; x += 1) cv.set(x, y, scaleRgb(c, 0.96 + 0.08 * noise2(x * 0.02, y * 0.2, seed + 3)));
  }
  const vx = VIEW_W * rng.range(0.4, 0.6);
  const stripeWidth = 150;
  for (let i = -14; i < 14; i += 2) {
    const bx = vx + i * stripeWidth;
    cv.quad(vx + (bx - vx) * 0.02, hor, vx + (bx + stripeWidth - vx) * 0.02, hor, bx + stripeWidth, VIEW_H, bx, VIEW_H, [255, 255, 200], 0.07);
  }
  // Winding path.
  const pathPts: Pt[] = [];
  const pathBack: Pt[] = [];
  for (let i = 0; i <= 28; i += 1) {
    const t = i / 28;
    const y = hor + 8 + t * (span - 8);
    const cx = vx + Math.sin(t * 3.4 + seed) * 120 * t + (t - 0.2) * 260 * (stack > "D" ? 1 : -1);
    const w = 3 + t * 60;
    pathPts.push([cx - w, y]);
    pathBack.unshift([cx + w, y]);
  }
  cv.poly([...pathPts, ...pathBack], mulRgb(mix([218, 198, 160], mood.horizon, 0.2), mood.tone), 0.85);
  // Pond with sky reflection and glint.
  const px = rng.range(0.15, 0.85) * VIEW_W;
  const py = hor + span * rng.range(0.3, 0.45);
  const pr = rng.range(110, 190);
  cv.ellipse(px, py, pr * 1.06, pr * 0.2, [58, 74, 52], 0.8);
  cv.ellipse(px, py, pr, pr * 0.16, mix(mood.horizon, mood.top, 0.6), 1);
  for (let i = 0; i < 90; i += 1) {
    const gx = px + rng.gauss() * pr * 0.35;
    const gy = py + rng.gauss() * pr * 0.04;
    cv.rect(gx - 6, gy, gx + rng.range(4, 22), gy + 1, [255, 255, 255], rng.range(0.15, 0.6));
  }
  // Trees, painted back to front.
  interface Tree {
    readonly x: number;
    readonly base: number;
  }
  const trees: Tree[] = [];
  for (let i = 0; i < 70; i += 1) trees.push({ x: rng.range(-20, VIEW_W + 20), base: hor + rng.range(2, 22) });
  for (let i = 0; i < 26; i += 1) trees.push({ x: rng.range(-30, VIEW_W + 30), base: hor + span * rng.range(0.12, 0.5) });
  for (let i = 0; i < 9; i += 1) {
    const edge = i % 2 === 0 ? rng.range(-60, 260) : rng.range(VIEW_W - 260, VIEW_W + 60);
    trees.push({ x: edge, base: hor + span * rng.range(0.7, 1.15) });
  }
  trees.sort((a, b) => a.base - b.base);
  for (const tree of trees) {
    const depth = clamp01((tree.base - hor) / span);
    const size = 7 + depth * depth * 150 + depth * 30;
    const haze = clamp01(0.55 - depth * 1.2);
    const lobes = 8 + Math.floor(depth * 46);
    cv.ellipse(tree.x + size * 0.25, tree.base + size * 0.02, size * 1.05, size * 0.16, [20, 50, 24], 0.28);
    cv.rect(tree.x - size * 0.06, tree.base - size * 0.55, tree.x + size * 0.06, tree.base, mulRgb([86, 62, 44], mood.tone), 1);
    const useAutumn = autumn && rng.chance(0.4);
    const treeBase = useAutumn ? rng.pick(AUTUMN) : rng.pick(GREENS);
    for (let l = 0; l < lobes; l += 1) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng.next()) * size * 0.72;
      const ox = Math.cos(a) * rr;
      const oy = Math.sin(a) * rr * 0.75;
      const lit = clamp01(0.5 + (-ox * 0.5 - oy * 0.9) / size);
      const baseC = mix(treeBase, rng.pick(useAutumn ? AUTUMN : GREENS), 0.3);
      const col = mix(mix(mulRgb(scaleRgb(baseC, 0.5), mood.tone), mulRgb(scaleRgb(baseC, 1.25), mood.tone), lit), mood.horizon, haze);
      const lr = size * rng.range(0.2, 0.4);
      cv.disc(tree.x + ox, tree.base - size * 1.0 + oy, lr, col, 1);
      if (lr > 6) cv.disc(tree.x + ox - lr * 0.3, tree.base - size * 1.0 + oy - lr * 0.35, lr * 0.55, mix(col, [255, 250, 190], 0.16), 0.55);
    }
  }
};

const mixToward = (mood: Mood, c: RGB, amount: number): RGB => mix(mulRgb(c, mood.tone), mood.horizon, amount * 0.5);

const BUILDING_PALETTES: readonly (readonly RGB[])[] = [
  [[196, 160, 128], [178, 130, 104], [214, 186, 150], [160, 112, 92]],
  [[120, 140, 168], [96, 118, 150], [140, 160, 186], [84, 104, 132]],
  [[170, 168, 164], [138, 138, 140], [196, 194, 188], [112, 114, 120]],
];

const paintCity = (s: Scene): void => {
  const { cv, rng, mood, hor, seed } = s;
  paintSky(s);
  const rise = 1 - s.bandIndex * 0.2;
  interface LayerSpec {
    readonly base: number;
    readonly top: number;
    readonly rise: number;
    readonly widthLo: number;
    readonly widthHi: number;
    readonly haze: number;
    readonly px: number;
    readonly py: number;
  }
  const span = VIEW_H - hor;
  cv.vgrad(hor, VIEW_H, mix(mood.horizon, [120, 120, 128], 0.45), [58, 58, 66]);
  const layers: LayerSpec[] = [
    { base: hor + 6, top: hor - 4, rise: 62, widthLo: 12, widthHi: 34, haze: 0.66, px: 3, py: 4 },
    { base: hor + span * 0.2, top: hor + span * 0.02, rise: 100, widthLo: 28, widthHi: 66, haze: 0.42, px: 5, py: 6 },
    { base: hor + span * 0.62, top: hor + span * 0.2, rise: 130, widthLo: 52, widthHi: 112, haze: 0.2, px: 8, py: 10 },
    { base: VIEW_H + 20, top: hor + span * 0.52, rise: 190, widthLo: 90, widthHi: 190, haze: 0.0, px: 13, py: 16 },
  ];
  layers.forEach((layer, li) => {
    let x = -rng.range(0, 40);
    let index = 0;
    while (x < VIEW_W + 20) {
      const w = rng.range(layer.widthLo, layer.widthHi);
      const tower = rng.chance(li === 3 ? 0.16 : 0.12);
      const topY = layer.top - layer.rise * rise * (tower ? rng.range(0.9, 1.7) : rng.range(-0.25, 0.8));
      const palette = rng.pick(BUILDING_PALETTES);
      const body = mix(mulRgb(rng.pick(palette), mood.tone), mood.horizon, layer.haze);
      const pxw = layer.px;
      const pyh = layer.py;
      const side = Math.max(3, w * 0.14);
      const gap = li === 0 ? 1 : 2;
      const x0 = x;
      const x1 = x + w - gap;
      cv.rect(x0, topY, x1, layer.base, body);
      cv.rect(x1 - side, topY, x1, layer.base, scaleRgb(body, 0.82));
      cv.rect(x0, topY, x1, topY + Math.max(1, pyh * 0.2), mix(body, [255, 250, 240], 0.28));
      const wc = mix(mix(mood.top, mood.horizon, 0.4), [40, 52, 74], 0.55 - layer.haze * 0.5);
      for (let wy = topY + pyh * 0.8; wy < layer.base - 2; wy += pyh) {
        for (let wx = x0 + pxw * 0.6; wx < x1 - side - pxw * 0.6; wx += pxw) {
          const lit = hash2((wx / pxw) | 0, (wy / pyh) | 0, seed + index) < (mood.sunElev < 0.2 ? 0.2 : 0.07);
          const c = lit ? mix([255, 214, 140], mood.horizon, layer.haze) : mix(wc, body, 0.18 + layer.haze * 0.4);
          cv.rect(wx, wy, wx + pxw * 0.55, wy + pyh * 0.55, c);
        }
      }
      if (tower || rng.chance(0.2)) {
        const setback = rng.chance(0.5);
        if (setback) {
          const inset = w * 0.2;
          const sh = rng.range(pyh * 2, pyh * 5);
          cv.rect(x0 + inset, topY - sh, x1 - inset - side * 0.4, topY, scaleRgb(body, 0.95));
          cv.rect(x1 - inset - side * 0.6, topY - sh, x1 - inset - side * 0.4, topY, scaleRgb(body, 0.8));
        }
        if (tower) {
          const ax = (x0 + x1 - side) / 2;
          const ah = rng.range(14, 36) * (0.6 + li * 0.3);
          const top = topY - (setback ? pyh * 3 : 0);
          cv.rect(ax - 0.5, top - ah, ax + 0.5 + li * 0.4, top, scaleRgb(body, 0.7));
          cv.disc(ax, top - ah, 1.6 + li * 0.3, [255, 70, 60], 0.9);
        }
      }
      index += 1;
      x += w;
    }
  });
  for (let y = hor - 10; y < hor + span * 0.5; y += 1) {
    const a = 0.26 * (1 - clamp01(Math.abs(y - (hor + 10)) / (span * 0.5 + 10)));
    for (let x = 0; x < VIEW_W; x += 1) cv.blend(x, y, mood.horizon, a * 0.7);
  }
};

const paintRidge = (s: Scene): void => {
  const { cv, rng, mood, hor, seed } = s;
  paintSky(s);
  const farBlue: RGB = [112, 140, 178];
  const nearGreen: RGB = [36, 84, 56];
  const layerCount = 6;
  for (let k = 0; k < layerCount; k += 1) {
    const f = k / (layerCount - 1);
    const baseY = hor - 66 + f * (VIEW_H - hor) * 0.82 + 10 * k;
    const amp = lerp(54, 70, f);
    const freq = lerp(0.0032, 0.0075, f);
    const offset = rng.range(0, 200);
    const haze = 0.62 - f * 0.6;
    const body = mix(mulRgb(mix(farBlue, nearGreen, Math.pow(f, 0.85)), mood.tone), mood.horizon, haze);
    const topFn = (x: number): number => baseY - amp * (fbm(x * freq + offset, k * 3.7, seed + k * 11, 5) - 0.3) * 1.5;
    cv.columns(0, VIEW_W, topFn, VIEW_H, (x, y) => {
      const depthBelow = y - topFn(x);
      const mist = 1 - smoothstep(0, 90 + 40 * (1 - f), depthBelow);
      const shade = 0.88 + 0.24 * noise2(x * 0.02, y * 0.05, seed + k);
      return mix(scaleRgb(body, shade), mood.horizon, mist * 0.08 + (1 - f) * 0.03 * (depthBelow / 90));
    });
    if (k >= 2) {
      const density = 14 + k * 14;
      for (let i = 0; i < density; i += 1) {
        const x = rng.range(0, VIEW_W);
        const top = topFn(x);
        const sz = 2 + f * 11;
        if (k >= 3 && rng.chance(0.14)) {
          const hy = top + rng.range(sz, sz * 4);
          const wall = mix(mulRgb(rng.pick<RGB>([[232, 224, 210], [214, 176, 142], [190, 190, 194]]), mood.tone), mood.horizon, haze * 0.6);
          cv.rect(x, hy - sz * 0.9, x + sz * 1.5, hy, wall);
          cv.poly([[x - sz * 0.15, hy - sz * 0.9], [x + sz * 1.65, hy - sz * 0.9], [x + sz * 0.75, hy - sz * 1.6]], mix([156, 78, 56], mood.horizon, haze * 0.6));
        } else {
          const ty = top + rng.range(0, sz * 2.5);
          const tc = mix(mulRgb(scaleRgb(rng.pick(GREENS), 0.8), mood.tone), mood.horizon, haze * 0.7);
          cv.poly([[x - sz * 0.5, ty], [x + sz * 0.5, ty], [x, ty - sz * 1.8]], tc);
        }
      }
    }
  }
  for (let y = hor - 14; y < hor + 24; y += 1) {
    const a = 0.2 * (1 - Math.abs(y - hor - 5) / 20);
    for (let x = 0; x < VIEW_W; x += 1) cv.blend(x, y, mood.horizon, Math.max(0, a));
  }
};

const renderView = (band: Band, stack: StackLetter, tag: ViewTag): Uint8Array => {
  const seed = hashString(`${band}/${stack}`);
  const rng = new Rng(seed);
  const bandIndex = BANDS.indexOf(band);
  const base = MOODS[stack];
  const mood: Mood = { ...base, sunX: clamp01(base.sunX + rng.range(-0.12, 0.12)), clouds: clamp01(base.clouds + rng.range(-0.15, 0.15)) };
  const hor = Math.round(VIEW_H * (HORIZON_FRACTION[band] as number) + rng.range(-4, 4));
  const scene: Scene = { cv: new Canvas(VIEW_W, VIEW_H), rng, mood, hor, bandIndex, seed, stack };
  switch (tag) {
    case "harbour":
      paintHarbour(scene);
      break;
    case "harbour-partial":
      paintHarbour(scene);
      paintCalderHouse(scene);
      break;
    case "park":
      paintPark(scene);
      break;
    case "city":
      paintCity(scene);
      break;
    case "ridge":
      paintRidge(scene);
      break;
  }
  return encodePng(VIEW_W, VIEW_H, scene.cv.toRgb8(seed));
};

// ---------------------------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------------------------

const ULTRAMARINE: readonly [number, number, number] = [0x2a, 0x1f, 0xd0];
const WHITE: readonly [number, number, number] = [0xff, 0xff, 0xff];

const solidRgb = (width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Uint8Array => {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) out.set(pixel(x, y), (y * width + x) * 3);
  }
  return out;
};

const facadeTexture = (): Uint8Array => {
  // One storey cell: a pane over the central 70% x 60% of the cell, split by a 6 px mullion.
  const pixel = (x: number, y: number): readonly [number, number, number] => {
    const inPane = x >= 38 && x < 218 && y >= 51 && y < 205;
    const inMullion = x >= 125 && x < 131;
    return inPane && !inMullion ? WHITE : ULTRAMARINE;
  };
  return encodePng(256, 256, solidRgb(256, 256, pixel));
};

const rampTexture = (): Uint8Array => encodePng(256, 1, solidRgb(256, 1, (x) => (x < 128 ? ULTRAMARINE : WHITE)));

// ---------------------------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------------------------

type V3 = readonly [number, number, number];

class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Adds a convex planar polygon with a flat outward normal; winding is corrected to match the normal. */
  polygon(points: readonly V3[], normal: V3, uvs: ReadonlyArray<readonly [number, number]>): void {
    const first = this.vertexCount;
    points.forEach((p, i) => {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      const uv = uvs[i] as readonly [number, number];
      this.uvs.push(uv[0], uv[1]);
    });
    const a = points[0] as V3;
    const b = points[1] as V3;
    const c = points[2] as V3;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2];
    for (let i = 1; i + 1 < points.length; i += 1) {
      if (dot >= 0) this.indices.push(first, first + i, first + i + 1);
      else this.indices.push(first, first + i + 1, first + i);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, normal: V3, uvs: ReadonlyArray<readonly [number, number]>): void {
    this.polygon([a, b, c, d], normal, uvs);
  }
}

/** Side walls of a plan prism between y0 and y1; u runs 0..1 along a face, v = y / STOREY_HEIGHT. */
const prismSides = (mb: MeshBuilder, scale: number, y0: number, y1: number, inward = false): void => {
  for (const face of faceCorners(scale)) {
    const s = face.start;
    const e = face.end;
    const n: V3 = inward ? [-face.normal.x, 0, -face.normal.z] : [face.normal.x, 0, face.normal.z];
    mb.quad(
      [s.x, y0, s.z],
      [e.x, y0, e.z],
      [e.x, y1, e.z],
      [s.x, y1, s.z],
      n,
      [
        [0, y0 / STOREY_HEIGHT],
        [1, y0 / STOREY_HEIGHT],
        [1, y1 / STOREY_HEIGHT],
        [0, y1 / STOREY_HEIGHT],
      ],
    );
  }
};

const planCap = (mb: MeshBuilder, scale: number, y: number, up: boolean): void => {
  const verts = planVertices(scale);
  const pts: V3[] = verts.map((p) => [p.x, y, p.z]);
  const uvs = verts.map((p): readonly [number, number] => [p.x / (APOTHEM * 2) + 0.5, p.z / (APOTHEM * 2) + 0.5]);
  mb.polygon(pts, [0, up ? 1 : -1, 0], uvs);
};

const planRing = (mb: MeshBuilder, outer: number, inner: number, y: number): void => {
  const o = planVertices(outer);
  const i = planVertices(inner);
  for (let k = 0; k < 8; k += 1) {
    const a = o[k] as { x: number; z: number };
    const b = o[(k + 1) % 8] as { x: number; z: number };
    const c = i[(k + 1) % 8] as { x: number; z: number };
    const d = i[k] as { x: number; z: number };
    mb.quad([a.x, y, a.z], [b.x, y, b.z], [c.x, y, c.z], [d.x, y, d.z], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
};

const box = (mb: MeshBuilder, cx: number, cz: number, w: number, d: number, y0: number, y1: number): void => {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const uv: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
  mb.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], uv);
  mb.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], uv);
  mb.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], uv);
  mb.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], uv);
  mb.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], uv);
};

interface MeshCounts {
  readonly vertices: number;
  readonly names: string[];
}

const attachPrimitive = (doc: Document, buffer: GltfBuffer, mb: MeshBuilder, material: ReturnType<Document["createMaterial"]>) => {
  const position = doc.createAccessor().setType("VEC3").setArray(new Float32Array(mb.positions)).setBuffer(buffer);
  const normal = doc.createAccessor().setType("VEC3").setArray(new Float32Array(mb.normals)).setBuffer(buffer);
  const uv = doc.createAccessor().setType("VEC2").setArray(new Float32Array(mb.uvs)).setBuffer(buffer);
  const indices = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(mb.indices)).setBuffer(buffer);
  return doc
    .createPrimitive()
    .setAttribute("POSITION", position)
    .setAttribute("NORMAL", normal)
    .setAttribute("TEXCOORD_0", uv)
    .setIndices(indices)
    .setMaterial(material);
};

const makeIo = async (): Promise<NodeIO> => {
  interface DracoFactory {
    createEncoderModule(): Promise<object>;
    createDecoderModule(): Promise<object>;
  }
  const require = createRequire(import.meta.url);
  const draco3d = require("draco3dgltf") as DracoFactory;
  return new NodeIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
    "draco3d.encoder": await draco3d.createEncoderModule(),
    "draco3d.decoder": await draco3d.createDecoderModule(),
  });
};

const enableDraco = (doc: Document): void => {
  doc
    .createExtension(KHRDracoMeshCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.SEQUENTIAL,
      encodeSpeed: 5,
      decodeSpeed: 5,
      quantizationBits: { POSITION: 16, NORMAL: 10, TEXCOORD: 14 },
    });
};

const linear = (srgb: number): number => {
  const c = srgb / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const ultramarineFactor = (): [number, number, number, number] => [linear(0x2a), linear(0x1f), linear(0xd0), 1];

const buildShell = (io: NodeIO): Promise<{ bytes: Uint8Array; counts: MeshCounts }> => {
  const doc = new Document();
  enableDraco(doc);
  const buffer = doc.createBuffer();
  const facade = doc.createMaterial("facade").setBaseColorFactor(ultramarineFactor()).setRoughnessFactor(0.55).setMetallicFactor(0.1);
  const podiumMat = doc.createMaterial("podium").setBaseColorFactor([0.55, 0.56, 0.62, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
  const roofMat = doc.createMaterial("roof").setBaseColorFactor([0.8, 0.8, 0.84, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);

  const tower = new MeshBuilder();
  prismSides(tower, 1, PODIUM_HEIGHT, TOWER_HEIGHT);
  const podium = new MeshBuilder();
  prismSides(podium, PODIUM_SCALE, 0, PODIUM_HEIGHT);
  planRing(podium, PODIUM_SCALE, 1, PODIUM_HEIGHT);
  const roof = new MeshBuilder();
  prismSides(roof, 1.02, TOWER_HEIGHT, TOWER_HEIGHT + 0.6);
  planCap(roof, 1.02, TOWER_HEIGHT + 0.6, true);
  box(roof, 2.5, -1.5, 6, 5, TOWER_HEIGHT + 0.6, TOWER_HEIGHT + 3.4);
  box(roof, -4.2, 3.4, 2.4, 2.4, TOWER_HEIGHT + 0.6, TOWER_HEIGHT + 2.2);

  const mesh = doc
    .createMesh("shell")
    .addPrimitive(attachPrimitive(doc, buffer, tower, facade))
    .addPrimitive(attachPrimitive(doc, buffer, podium, podiumMat))
    .addPrimitive(attachPrimitive(doc, buffer, roof, roofMat));
  const scene = doc.createScene("tower-shell");
  scene.addChild(doc.createNode("shell").setMesh(mesh));
  doc.getRoot().setDefaultScene(scene);
  const vertices = tower.vertexCount + podium.vertexCount + roof.vertexCount;
  return io.writeBinary(doc).then((bytes) => ({ bytes, counts: { vertices, names: ["shell"] } }));
};

const PARAPET: Readonly<Record<Band, number>> = { "03-09": 0.25, "10-19": 0.4, "20-29": 0.55, "30-35": 0.7, "36-38": 0.9 };

const buildPlate = (io: NodeIO, band: Band): Promise<{ bytes: Uint8Array; counts: MeshCounts }> => {
  const doc = new Document();
  enableDraco(doc);
  const buffer = doc.createBuffer();
  const slabMat = doc.createMaterial("plate").setBaseColorFactor([0.86, 0.86, 0.9, 1]).setRoughnessFactor(0.6).setMetallicFactor(0);
  const thickness = 0.35;
  const ledge = PARAPET[band];
  const outer = 1.04;
  const inner = 1.02;
  const mb = new MeshBuilder();
  prismSides(mb, outer, 0, thickness + ledge);
  planCap(mb, outer, 0, false);
  planCap(mb, inner, thickness, true);
  prismSides(mb, inner, thickness, thickness + ledge, true);
  planRing(mb, outer, inner, thickness + ledge);
  const mesh = doc.createMesh("plate").addPrimitive(attachPrimitive(doc, buffer, mb, slabMat));
  const scene = doc.createScene(`plate-${band}`);
  scene.addChild(doc.createNode("plate").setMesh(mesh));
  const names = ["plate"];
  for (const letter of STACK_LETTERS) {
    const b = (STACKS[letter].bearing * Math.PI) / 180;
    const theta = Math.PI - b;
    const node = doc
      .createNode(`window-${letter}`)
      .setTranslation([Math.sin(b) * APOTHEM, STOREY_HEIGHT / 2, -Math.cos(b) * APOTHEM])
      .setRotation([0, Math.sin(theta / 2), 0, Math.cos(theta / 2)]);
    scene.addChild(node);
    names.push(node.getName());
  }
  doc.getRoot().setDefaultScene(scene);
  return io.writeBinary(doc).then((bytes) => ({ bytes, counts: { vertices: mb.vertexCount, names } }));
};

// ---------------------------------------------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------------------------------------------

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(`asset verification failed: ${message}`);
};

const rawGlbJson = (bytes: Uint8Array): { extensionsUsed?: string[]; extensionsRequired?: string[] } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0, true) === 0x46546c67, "GLB magic");
  const length = view.getUint32(12, true);
  assert(view.getUint32(16, true) === 0x4e4f534a, "first chunk is JSON");
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as { extensionsUsed?: string[]; extensionsRequired?: string[] };
};

const verifyGlb = async (io: NodeIO, label: string, bytes: Uint8Array, counts: MeshCounts): Promise<void> => {
  const json = rawGlbJson(bytes);
  assert((json.extensionsUsed ?? []).includes("KHR_draco_mesh_compression"), `${label} extensionsUsed`);
  assert((json.extensionsRequired ?? []).includes("KHR_draco_mesh_compression"), `${label} extensionsRequired`);
  const doc = await io.readBinary(bytes);
  let vertices = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) vertices += prim.getAttribute("POSITION")?.getCount() ?? 0;
  }
  assert(vertices === counts.vertices, `${label} vertex count ${vertices} !== ${counts.vertices}`);
  const nodeNames = doc.getRoot().listNodes().map((n) => n.getName());
  for (const name of counts.names) assert(nodeNames.includes(name), `${label} missing node ${name}`);
  for (const letter of STACK_LETTERS) {
    const node = doc.getRoot().listNodes().find((n) => n.getName() === `window-${letter}`);
    if (!node) continue;
    const [x, , z] = node.getTranslation();
    const bearing = (((Math.round((Math.atan2(x, -z) * 180) / Math.PI) % 360) + 360) % 360);
    assert(bearing === STACKS[letter].bearing, `${label} window-${letter} bearing ${bearing}`);
  }
  assert(normalOf(0).z === -1, "model axes");
};

// ---------------------------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------------------------

const viewTagFor = (band: Band, stack: StackLetter): ViewTag => STACKS[stack].view(BAND_FLOORS[band][1]);

const main = async (): Promise<void> => {
  const io = await makeIo();

  const shell = await buildShell(io);
  await verifyGlb(io, "tower-shell", shell.bytes, shell.counts);
  emit("models/tower-shell.glb", shell.bytes);

  for (const band of BANDS) {
    const plate = await buildPlate(io, band);
    await verifyGlb(io, `plate ${band}`, plate.bytes, plate.counts);
    emit(`models/plates/${band}.glb`, plate.bytes);
  }

  emit("textures/facade.png", facadeTexture());
  emit("textures/duotone-ramp.png", rampTexture());

  let viewCount = 0;
  for (const band of BANDS) {
    if (band === "36-38") continue;
    for (const stack of STACK_LETTERS) {
      if (band === "30-35" && stack === "H") continue;
      const png = renderView(band, stack, viewTagFor(band, stack));
      assert(png.length < 600_000, `view ${band}/${stack} is ${png.length} bytes`);
      emit(`views/bands/${band}/${stack}.png`, png);
      viewCount += 1;
    }
  }
  assert(viewCount === 31, "31 views");

  const manifest = generated
    .map((file) => ({
      path: file.path,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      bytes: file.bytes.length,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  writeFileSync(join(SEED_ROOT, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const total = manifest.reduce((sum, entry) => sum + entry.bytes, 0);
  const largestView = Math.max(...manifest.filter((m) => m.path.startsWith("views/")).map((m) => m.bytes));
  console.log(`seed assets: ${manifest.length} files, ${(total / 1024).toFixed(0)} KiB total, ${viewCount} views (largest ${(largestView / 1024).toFixed(0)} KiB)`);
};

await main();
