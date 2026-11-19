// Generated placeholder plates for the seed image references (brief: Seed data): PNGs with no metadata
// chunks, one motif per title so the wall reads as a real board.
import { crc32, deflateSync } from "node:zlib";

export type Motif = "weave" | "coil" | "glow" | "folds" | "net" | "tide" | "rust" | "fog" | "ridges" | "scree" | "cells" | "lace" | "spiral";
export type Rgb = readonly [number, number, number];

export interface Plate {
  motif: Motif;
  palette: readonly [Rgb, Rgb, Rgb];
  /** Height over width. */
  aspect: number;
  seed: number;
}

/** About 1.4x the widest wall card (a phone column is about 343 CSS px): the brief's seed plates are small. */
const WIDTH = 480;
/** Tone steps: banded flat colour keeps each plate a small PNG (brief: "small generated placeholder PNGs"). */
const STEPS = 16;

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Deterministic value noise in [0, 1). */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed) + (hash(xi + 1, yi, seed) - hash(xi, yi, seed)) * sx;
  const b = hash(xi, yi + 1, seed) + (hash(xi + 1, yi + 1, seed) - hash(xi, yi + 1, seed)) * sx;
  return a + (b - a) * sy;
}

/** Fractal value noise: rotated octaves so no single lattice shows through as square blocks. */
function fractal(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let weight = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, y, seed + o) * weight;
    total += weight;
    [x, y] = [(x * 0.8 - y * 0.6) * 2.03, (x * 0.6 + y * 0.8) * 2.03];
    weight *= 0.5;
  }
  return sum / total;
}

const smooth = (edge0: number, edge1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Intensity in [0, 1] for each motif at normalised coordinates. */
function field(motif: Motif, u: number, v: number, aspect: number, seed: number): number {
  const y = v * aspect;
  const grain = (noise(u * 520, y * 520, seed) - 0.5) * 0.06;
  switch (motif) {
    case "weave": {
      const warp = Math.abs(Math.sin(u * 90)) ** 0.5;
      const weft = Math.abs(Math.sin(y * 90)) ** 0.5;
      const over = Math.sin(u * 45) * Math.sin(y * 45) > 0 ? warp : weft;
      return 0.3 + over * 0.4 + noise(u * 5, y * 5, seed) * 0.25 + grain;
    }
    case "coil": {
      const r = Math.hypot(u - 0.5, y - aspect / 2);
      const a = Math.atan2(y - aspect / 2, u - 0.5);
      return smooth(0.48, 0.1, r) * (0.55 + 0.45 * Math.sin(r * 120 + a * 2)) + grain;
    }
    case "glow": {
      const r = Math.hypot(u - 0.62, y - aspect * 0.35);
      return 0.12 + smooth(0.75, 0.0, r) ** 2 * 0.9 + grain * 0.5;
    }
    case "folds":
      return 0.3 + 0.35 * Math.sin((u + y * 0.6) * 9 + Math.sin(y * 4) * 1.4) ** 2 + noise(u * 3, y * 3, seed) * 0.3;
    case "net": {
      const d1 = Math.abs(Math.sin((u + y) * 28));
      const d2 = Math.abs(Math.sin((u - y) * 28));
      return 0.2 + smooth(0.92, 1, Math.max(d1, d2)) * 0.7 + grain;
    }
    case "tide":
      return 0.25 + smooth(0.7, 1, Math.abs(Math.sin(y * 32 + Math.sin(u * 7 + y * 3) * 1.2))) * 0.55 + v * 0.2;
    case "rust":
      return 0.15 + fractal(u * 4, y * 4, seed, 6) * 0.75 + grain;
    case "fog":
      return 0.2 + smooth(0.2, 0.9, v) * 0.35 + fractal(u * 2.5, y * 7, seed, 4) * 0.45;
    case "ridges": {
      let value = 0.85;
      for (let layer = 0; layer < 4; layer++) {
        const crest = 0.35 + layer * 0.15 + noise(u * (3 + layer * 2), layer, seed) * 0.18;
        if (v > crest) value = 0.15 + layer * 0.18;
      }
      return value + grain;
    }
    case "scree": {
      const cx = u * 16;
      const cy = y * 16;
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      const d = Math.hypot(cx - ix - 0.3 - hash(ix, iy, seed) * 0.4, cy - iy - 0.3 - hash(ix, iy, seed + 3) * 0.4);
      const r = 0.22 + hash(ix, iy, seed + 5) * 0.18;
      return 0.18 + smooth(r, r - 0.07, d) * (0.35 + hash(ix, iy, seed + 9) * 0.45) + grain;
    }
    case "cells": {
      const cx = u * 9;
      const cy = y * 9;
      const jitter = noise(cx * 1.7, cy * 1.7, seed);
      return 0.3 + smooth(0.15, 0.5, Math.abs(Math.sin(cx * 3.1 + jitter * 3) * Math.sin(cy * 3.1 - jitter * 3))) * 0.6;
    }
    case "lace":
      return 0.2 + smooth(0.9, 1, Math.abs(Math.sin((u * 2 + y) * 30))) * 0.5 + smooth(0.9, 1, Math.abs(Math.sin((u * 2 - y) * 30))) * 0.3;
    case "spiral": {
      const r = Math.hypot(u - 0.5, y - aspect / 2);
      const a = Math.atan2(y - aspect / 2, u - 0.5);
      return 0.25 + 0.6 * smooth(0.3, 0.9, Math.sin(a * 3 + r * 40)) * smooth(0.55, 0.05, r);
    }
  }
}

export function renderPlate(plate: Plate): Buffer {
  const height = Math.round(WIDTH * plate.aspect);
  const rgb = Buffer.alloc(WIDTH * height * 3);
  const [low, mid, high] = plate.palette;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < WIDTH; px++) {
      const u = px / WIDTH;
      const t = Math.round(Math.min(1, Math.max(0, field(plate.motif, u, py / height, plate.aspect, plate.seed))) * STEPS) / STEPS;
      const [from, to, k] = t < 0.5 ? [low, mid, t * 2] : [mid, high, (t - 0.5) * 2];
      const at = (py * WIDTH + px) * 3;
      for (let c = 0; c < 3; c++) rgb[at + c] = Math.round((from[c] ?? 0) + ((to[c] ?? 0) - (from[c] ?? 0)) * k);
    }
  }
  return encodePng(WIDTH, height, rgb);
}
