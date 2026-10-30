// Procedural halftone frames for the seeded essays: each essay has its own scene, each frame a different
// view of it, screened as rotated ink dots on newsprint. Deterministic, so every seed run draws the same prints.
import type { Raster } from "./image-worker.js";

type Scene = (x: number, y: number) => number; // tone 0 (ink) .. 1 (paper), x and y in 0..1

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const s = (t: number): number => t * t * (3 - 2 * t);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return (a * (1 - s(fx)) + b * s(fx)) * (1 - s(fy)) + (c * (1 - s(fx)) + d * s(fx)) * s(fy);
}

const fbm = (x: number, y: number, seed: number): number =>
  0.55 * noise(x, y, seed) + 0.3 * noise(x * 2.1, y * 2.1, seed + 7) + 0.15 * noise(x * 4.3, y * 4.3, seed + 13);

const clamp = (v: number): number => Math.min(1, Math.max(0, v));

function floodplain(frame: number): Scene {
  const horizon = 0.42 + 0.05 * Math.sin(frame * 1.7);
  const pan = frame * 0.17;
  return (x, y) => {
    if (y < horizon) {
      const cloud = fbm(x * 3 + pan, y * 6, frame) * 0.35;
      return clamp(0.92 - (horizon - y) * 0.6 + cloud - 0.15);
    }
    const levee = horizon + 0.05 + (x - 0.5) * 0.18;
    if (Math.abs(y - levee) < 0.022) return 0.18 + fbm(x * 40, y * 40, 3) * 0.2;
    const posts = Math.abs(((x + pan) * 14) % 1 - 0.5) < 0.04 && y > levee - 0.09 && y < levee ? 0.1 : 1;
    if (posts < 1) return posts;
    const water = 0.55 + 0.3 * Math.sin((y - horizon) * 90 + fbm(x * 8, y * 30, frame + 2) * 6) * (y - horizon);
    return clamp(water - fbm(x * 5 + pan, y * 9, frame + 5) * 0.25);
  };
}

function nightShift(frame: number): Scene {
  const base = 0.28 + 0.06 * (frame % 3);
  return (x, y) => {
    const glow = Math.exp(-((x - 0.62) ** 2 + (y - 0.2) ** 2) * 9) * 0.65;
    let tone = 0.08 + glow + fbm(x * 4, y * 4, frame) * 0.08;
    const silos = [0.18, 0.3, 0.42, 0.54].map((s) => s + frame * 0.02);
    for (const s of silos) {
      if (Math.abs(x - s) < 0.05 && y > base) tone = 0.55 + 0.3 * Math.cos((x - s) * 30) - glow * 0.3;
    }
    if (x > 0.62 && x < 0.86 && y > base - 0.12) {
      tone = 0.22;
      if (Math.abs(((x - 0.62) * 22) % 1 - 0.5) < 0.18 && Math.abs(((y - base) * 18) % 1 - 0.5) < 0.2) tone = 0.95;
    }
    if (y > 0.86) tone = 0.12 + fbm(x * 20, y * 20, 9) * 0.25;
    return clamp(tone);
  };
}

function saltMarsh(frame: number): Scene {
  const horizon = 0.36 + 0.04 * frame;
  return (x, y) => {
    if (y < horizon) {
      const sun = Math.exp(-((x - 0.3 - frame * 0.08) ** 2 + (y - horizon + 0.05) ** 2) * 60) * 0.5;
      return clamp(0.62 + (horizon - y) * 0.5 + sun);
    }
    const blade = noise(x * 160, y * 6, frame + 4);
    const channel = Math.abs(y - (horizon + 0.22 + Math.sin(x * 7 + frame) * 0.05)) < 0.035;
    if (channel) return clamp(0.85 - fbm(x * 30, y * 30, 11) * 0.3);
    const birds = hash(Math.floor(x * 22), Math.floor(y * 30), frame + 31) > 0.985 && y < horizon + 0.25 ? 0.05 : 1;
    return Math.min(birds, clamp(0.25 + blade * 0.45 + (y - horizon) * -0.2));
  };
}

function borderChoir(frame: number): Scene {
  const river = 0.55 + 0.03 * frame;
  return (x, y) => {
    if (Math.abs(y - river) < 0.06) return clamp(0.82 - Math.sin(x * 60 + y * 30) * 0.08);
    let tone = y < river ? 0.7 - y * 0.3 : 0.55 - (y - river) * 0.4;
    const rows = y < river ? [0.32, 0.4] : [0.72, 0.8];
    for (const row of rows) {
      const cx = ((x + frame * 0.03) * 16) % 1 - 0.5;
      if (Math.hypot(cx / 16, y - row) < 0.018) tone = 0.08;
      if (Math.abs(cx) < 0.28 && y > row + 0.012 && y < row + 0.07) tone = 0.18;
    }
    return clamp(tone + (fbm(x * 9, y * 9, frame) - 0.5) * 0.15);
  };
}

function riverSeries(frame: number): Scene {
  return (x, y) => {
    const bend = 0.5 + Math.sin(y * 4 + frame) * 0.18;
    if (Math.abs(x - bend) < 0.08 + y * 0.08) return clamp(0.78 + Math.sin(y * 120) * 0.08);
    return clamp(0.35 + fbm(x * 6, y * 6, frame + 3) * 0.4);
  };
}

const SCENES: Record<string, (frame: number) => Scene> = {
  "floodplain-ledger": floodplain,
  "night-shift-grain": nightShift,
  "salt-marsh-census": saltMarsh,
  "border-choir": borderChoir,
  "river-series-draft": riverSeries,
};

const PAPER = [239, 233, 219];
const INK = [26, 30, 36];

/** Screens the essay's scene as a 45° halftone of round ink dots. */
export function drawHalftone(essayId: string, frame: number, width: number, height: number): Raster {
  const scene = (SCENES[essayId] ?? riverSeries)(frame);
  const cell = 9;
  const data = new Uint8Array(width * height * 4);
  const s = Math.SQRT1_2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + y) * s, v = (y - x) * s;
      const cu = (Math.floor(u / cell) + 0.5) * cell, cv = (Math.floor(v / cell) + 0.5) * cell;
      const cx = (cu - cv) * s, cy = (cu + cv) * s;
      const tone = scene(Math.min(1, Math.max(0, cx / width)), Math.min(1, Math.max(0, cy / height)));
      const radius = cell * 0.74 * Math.sqrt(1 - tone);
      const d = Math.hypot(u - cu, v - cv);
      const ink = clamp(radius + 0.5 - d);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) data[o + c] = Math.round((PAPER[c] ?? 0) * (1 - ink) + (INK[c] ?? 0) * ink);
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}
