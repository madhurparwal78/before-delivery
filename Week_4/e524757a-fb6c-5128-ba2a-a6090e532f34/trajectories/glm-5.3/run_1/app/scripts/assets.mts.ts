// Renders the bundled landing-page fragments and still-island maps from the world's own code.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

// Minimal PNG writer: 8-bit RGB, no interlace.
function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = rowStart + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const out: number[] = [];
  out.push(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  chunk(out, "IHDR", ihdr);
  chunk(out, "IDAT", deflateSync(raw));
  chunk(out, "IEND", Buffer.alloc(0));
  return Buffer.from(out);
}

function chunk(out: number[], type: string, data: Buffer): void {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  out.push(...len, ...Buffer.from(type, "ascii"), ...data, ...crc32(Buffer.concat([Buffer.from(type, "ascii"), data])));
}

let table: number[] | null = null;
function crc32(buf: Buffer): number[] {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  const out = Buffer.alloc(4);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return [...out];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// A rendered coast scene: horizon, water, shore band, dune grass.
function coastScene(seed: number, w: number, h: number): Buffer {
  const horizon = Math.floor(h * 0.42);
  return png(w, h, (x, y) => {
    const nx = x / w;
    const ny = y / h;
    if (y < horizon) {
      const t = ny / 0.42;
      const r = lerp(120, 190, t) + 12 * Math.sin(nx * 18 + seed);
      const g = lerp(170, 215, t);
      const b = lerp(215, 235, t);
      return [clamp(r), clamp(g), clamp(b)];
    }
    const shoreY = horizon + Math.floor(h * 0.22 * (0.5 + 0.4 * Math.sin(nx * 9 + seed * 2)));
    if (y < shoreY) {
      const t = (y - horizon) / (shoreY - horizon);
      const wave = 6 * Math.sin(nx * 60 + y * 0.9 + seed * 3);
      const r = lerp(64, 190, t) + wave;
      const g = lerp(120, 215, t) + wave;
      const b = lerp(160, 225, t);
      return [clamp(r), clamp(g), clamp(b)];
    }
    const dune = 18 * Math.sin(nx * 30 + seed) + 10 * Math.sin(nx * 70);
    if (y < shoreY + h * 0.14 + dune) {
      const g = lerp(150, 110, (y - shoreY) / (h * 0.2));
      return [clamp(g * 0.55), clamp(g), clamp(g * 0.45)];
    }
    const grass = 30 * Math.sin(x * 0.9 + seed) + 25 * Math.sin(x * 2.3 + y * 0.4);
    return [clamp(88 + grass * 0.3), clamp(122 + grass * 0.5), clamp(70 + grass * 0.25)];
  });
}

// An album page fragment: a filled tide-newt page.
function albumFragment(w: number, h: number): Buffer {
  return png(w, h, (x, y) => {
    const nx = x / w;
    const ny = y / h;
    // Photo area on top, caption band below.
    if (ny < 0.72) {
      const inFrame = nx > 0.12 && nx < 0.88 && ny > 0.1 && ny < 0.62;
      if (!inFrame) return [236, 234, 231];
      // Wump-ish newt on moss.
      const cx = 0.5, cy = 0.36;
      const d = Math.hypot(nx - cx, (ny - cy) * 0.7);
      if (d < 0.16) {
        const belly = Math.abs(nx - cx) < 0.07 && ny > cy;
        return belly ? [216, 201, 141] : [76, 107, 63];
      }
      const moss = 12 * Math.sin(nx * 40 + ny * 25);
      return [clamp(84 + moss), clamp(132 + moss), clamp(80 + moss * 0.5)];
    }
    return [255, 255, 255];
  });
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const outDir = path.join(process.cwd(), "dist", "public");
mkdirSync(outDir, { recursive: true });

for (let i = 1; i <= 3; i++) {
  writeFileSync(path.join(outDir, `coast-${i}.png`), coastScene(i * 3.7, 480, 360));
}
writeFileSync(path.join(outDir, "album-fragment.png"), albumFragment(480, 360));

// Still maps for the five islands: water, rock, pond, lighthouse, land.
const GRID = 24;
const ISLANDS = [
  { pond: [15, 17, 3, 5], rocks: [[6, 6], [7, 6], [8, 6], [14, 14], [14, 15], [14, 16]], lighthouse: null as [number, number] | null },
  { pond: [4, 6, 15, 17], rocks: [[10, 4], [10, 5], [10, 6], [17, 17], [18, 17], [19, 17]], lighthouse: null },
  { pond: [11, 13, 11, 13], rocks: [[5, 18], [6, 18], [7, 18], [18, 5], [18, 6], [18, 7]], lighthouse: null },
  { pond: [17, 19, 15, 17], rocks: [[4, 9], [5, 9], [6, 9], [12, 2], [12, 3], [12, 4]], lighthouse: null },
  { pond: [3, 5, 3, 5], rocks: [[9, 15], [10, 15], [11, 15], [16, 9], [16, 10], [16, 11], [20, 4]], lighthouse: [20, 4] as [number, number] }
];

function stillMap(islandIndex: number, px: number): Buffer {
  const island = ISLANDS[islandIndex];
  return png(px, px, (x, y) => {
    const tx = Math.floor(x / px * GRID);
    const ty = Math.floor(y / px * GRID);
    if (tx === 0 || ty === 0 || tx === GRID - 1 || ty === GRID - 1) return [45, 108, 143];
    const [px0, px1, py0, py1] = island.pond;
    if (tx >= px0 && tx <= px1 && ty >= py0 && ty <= py1) return [45, 108, 143];
    if (island.rocks.some(([rx, ry]) => rx === tx && ry === ty)) return [141, 138, 132];
    if (island.lighthouse && island.lighthouse[0] === tx && island.lighthouse[1] === ty) return [242, 239, 232];
    const shade = 10 * Math.sin(tx * 1.7 + ty * 2.3);
    return [clamp(105 + shade), clamp(160 + shade), clamp(90 + shade * 0.5)];
  });
}

for (let i = 1; i <= 5; i++) {
  writeFileSync(path.join(outDir, `still-map-${i}.png`), stillMap(i - 1, 480));
}

console.log("assets done");
