// Procedural fixture photographs: invented Aldmere crowns drawn as a relief heightmap, lit like a
// studio photograph and encoded as 1000×1000 PNGs. The diagnostic feature (mintmark, scratch,
// gouge) always sits at original-image coordinate (600,400).

import { deflateSync } from "node:zlib";

const SIZE = 1000;
const CX = 500;
const CY = 500;
/** Outer edge of the coin, matching the register drawings (a 40px rim stroke centred on r=430). */
const RADIUS = 450;
const FEATURE = { x: 600, y: 400 } as const;
/** The register drawings' ground (#d9d6cf), so a photograph and a drawing read as one coin across a wipe. */
const GROUND = [217, 214, 207] as const;

type Stroke = [number, number][];

/** A stroke font on a 4×6 grid (y down). */
const GLYPHS: Record<string, Stroke[]> = {
  A: [[[0, 6], [2, 0], [4, 6]], [[0.9, 3.9], [3.1, 3.9]]],
  C: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
  D: [[[0, 0], [0, 6], [2.4, 6], [4, 4.6], [4, 1.4], [2.4, 0], [0, 0]]],
  E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
  K: [[[0, 0], [0, 6]], [[4, 0], [0, 3.6]], [[1.3, 2.6], [4, 6]]],
  L: [[[0, 0], [0, 6], [4, 6]]],
  M: [[[0, 6], [0, 0], [2, 3.4], [4, 0], [4, 6]]],
  N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
  O: [[[1.2, 0], [2.8, 0], [4, 1.3], [4, 4.7], [2.8, 6], [1.2, 6], [0, 4.7], [0, 1.3], [1.2, 0]]],
  R: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]], [[2, 3], [4, 6]]],
  W: [[[0, 0], [1, 6], [2, 2.6], [3, 6], [4, 0]]],
  "1": [[[0.8, 1.2], [2, 0], [2, 6]], [[0.8, 6], [3.2, 6]]],
  "9": [[[4, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6]]],
};

export interface CoinFace {
  side: "obverse" | "reverse";
  mintmark: string;
  /** Box-blur radius of wear in pixels: 1 is crisp, 9 is heavily circulated. */
  wear: number;
  /** Metal tint multiplier (red, green, blue). */
  tone: [number, number, number];
  repunched?: boolean;
  mark?: "scratch" | "gouge";
  /** Small lighting shift so arrival photographs read as a new shot of the same coin. */
  lightShift?: number;
  seed: number;
}

function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

class Relief {
  readonly h = new Float32Array(SIZE * SIZE);

  /** Raises a round-ended stroke from a to b; the edge falls off over ~1.5 px for a crisp letter. */
  segment(ax: number, ay: number, bx: number, by: number, width: number, height: number): void {
    const half = width / 2;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - half - 2));
    const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(ax, bx) + half + 2));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - half - 2));
    const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(ay, by) + half + 2));
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2));
        const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
        if (d > half + 1.5) continue;
        const edge = d <= half - 1.5 ? 1 : (half + 1.5 - d) / 3;
        const crown = 1 - 0.35 * (d / (half + 1.5)) ** 2;
        const value = height * edge * crown;
        const i = y * SIZE + x;
        if (value > this.h[i]!) this.h[i] = value;
      }
    }
  }

  dot(cx: number, cy: number, r: number, height: number): void {
    for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
      for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r + 1) continue;
        const value = height * Math.sqrt(Math.max(0, 1 - (d / (r + 1)) ** 2));
        const i = y * SIZE + x;
        if (value > this.h[i]!) this.h[i] = value;
      }
    }
  }

  polygon(points: Stroke, height: number): void {
    const ys = points.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const crossings: number[] = [];
      for (let k = 0; k < points.length; k++) {
        const [x1, y1] = points[k]!;
        const [x2, y2] = points[(k + 1) % points.length]!;
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
      crossings.sort((a, b) => a - b);
      for (let c = 0; c + 1 < crossings.length; c += 2) {
        for (let x = Math.ceil(crossings[c]!); x <= Math.floor(crossings[c + 1]!); x++) {
          const i = y * SIZE + x;
          if (height > this.h[i]!) this.h[i] = height;
        }
      }
    }
  }

  /** Draws a glyph with its x axis along (ux,uy) and its y axis along (vx,vy). */
  glyph(ch: string, cx: number, cy: number, scale: number, ux: number, uy: number, vx: number, vy: number, width: number, height: number): void {
    for (const stroke of GLYPHS[ch] ?? []) {
      const pts = stroke.map(([gx, gy]) => {
        const lx = (gx - 2) * scale;
        const ly = (gy - 3) * scale;
        return [cx + lx * ux + ly * vx, cy + lx * uy + ly * vy] as const;
      });
      for (let k = 0; k + 1 < pts.length; k++) this.segment(pts[k]![0], pts[k]![1], pts[k + 1]![0], pts[k + 1]![1], width, height);
    }
  }

  /** A legend around the rim: `top` reads along the upper arc, otherwise along the lower arc. */
  legend(textValue: string, radius: number, centre: number, spread: number, top: boolean): void {
    const chars = [...textValue];
    chars.forEach((ch, index) => {
      if (ch === " ") return;
      const offset = chars.length === 1 ? 0 : (index / (chars.length - 1) - 0.5) * spread;
      const theta = top ? centre + offset : centre - offset;
      const x = CX + radius * Math.cos(theta);
      const y = CY + radius * Math.sin(theta);
      if (ch === "·") {
        this.dot(x, y, 6, 0.7);
        return;
      }
      if (top) this.glyph(ch, x, y, 9, -Math.sin(theta), Math.cos(theta), -Math.cos(theta), -Math.sin(theta), 9, 0.75);
      else this.glyph(ch, x, y, 9, Math.sin(theta), -Math.cos(theta), Math.cos(theta), Math.sin(theta), 9, 0.75);
    });
  }

  blur(radius: number): void {
    if (radius <= 0) return;
    const tmp = new Float32Array(SIZE * SIZE);
    const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
      const span = 2 * radius + 1;
      for (let line = 0; line < SIZE; line++) {
        let sum = 0;
        const at = (k: number) => {
          const c = Math.max(0, Math.min(SIZE - 1, k));
          return horizontal ? from[line * SIZE + c]! : from[c * SIZE + line]!;
        };
        for (let k = -radius; k <= radius; k++) sum += at(k);
        for (let k = 0; k < SIZE; k++) {
          to[horizontal ? line * SIZE + k : k * SIZE + line] = sum / span;
          sum += at(k + radius + 1) - at(k - radius);
        }
      }
    };
    pass(this.h, tmp, true);
    pass(tmp, this.h, false);
  }
}

function crownMotif(relief: Relief): void {
  const base = 600;
  relief.polygon([[330, base], [570, base], [590, base - 70], [545, base - 30], [510, base - 130], [470, base - 40],
    [450, base - 150], [430, base - 40], [390, base - 130], [355, base - 30], [310, base - 70]], 0.55);
  relief.polygon([[325, base + 8], [575, base + 8], [575, base + 46], [325, base + 46]], 0.62);
  for (const x of [365, 410, 450, 490, 535]) relief.dot(x, base + 27, 9, 0.8);
  for (const [x, y] of [[310, base - 74], [390, base - 134], [450, base - 156], [510, base - 134], [590, base - 74]] as const) {
    relief.dot(x, y, 11, 0.75);
  }
}

function wreathMotif(relief: Relief): void {
  for (let k = 0; k < 9; k++) {
    for (const side of [-1, 1]) {
      const theta = Math.PI / 2 + side * (0.35 + k * 0.17);
      const x = CX + 240 * Math.cos(theta);
      const y = CY + 30 + 200 * Math.sin(theta) * 0.9;
      relief.segment(x - 14 * side, y - 10, x + 14 * side, y + 10, 16, 0.5);
    }
  }
  const word = "CROWN";
  [...word].forEach((ch, i) => relief.glyph(ch, 360 + i * 56, 610, 8.5, 1, 0, 0, 1, 10, 0.7));
  relief.glyph("1", 470, 540, 12, 1, 0, 0, 1, 14, 0.8);
}

function encodePng(rgb: Buffer): Buffer {
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 3 + 1);
    raw[row] = 1; // Sub filter
    for (let x = 0; x < SIZE * 3; x++) {
      const value = rgb[y * SIZE * 3 + x]!;
      const left = x >= 3 ? rgb[y * SIZE * 3 + x - 3]! : 0;
      raw[row + 1 + x] = (value - left) & 0xff;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 7 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Renders one face of a fixture coin as PNG bytes. */
export function drawCoin(face: CoinFace): Buffer {
  const relief = new Relief();
  const random = rng(face.seed);
  for (let i = 0; i < 90; i++) {
    const theta = (i / 90) * Math.PI * 2;
    relief.dot(CX + 378 * Math.cos(theta), CY + 378 * Math.sin(theta), 5, 0.55);
  }
  if (face.side === "obverse") {
    relief.legend("ALDMERE", 318, -Math.PI / 2, 1.5, true);
    relief.legend("1911", 318, Math.PI / 2, 0.75, false);
    crownMotif(relief);
  } else {
    relief.legend("ALDMERE·CROWN", 318, -Math.PI / 2, 2.3, true);
    wreathMotif(relief);
  }
  if (face.repunched) relief.glyph(face.mintmark, FEATURE.x + 6, FEATURE.y - 5, 10, 1.6, 0, 0, 1, 7, 0.45);
  // Sized to the register drawing's letter box (about 64 x 60 at this point), so the mintmark sits in the same place across a wipe.
  relief.glyph(face.mintmark, FEATURE.x, FEATURE.y, 10, 1.6, 0, 0, 1, 11, 0.95);
  relief.blur(Math.max(2, face.wear));
  const worn = face.wear > 5;
  const amplitude = worn ? 0.3 : 0.75;
  const h = relief.h;
  const rgb = Buffer.alloc(SIZE * SIZE * 3);
  const shift = face.lightShift ?? 0;
  const light = [-0.55 + shift, -0.62, 0.56];
  const norm = Math.hypot(...light);
  const [lx, ly, lz] = light.map((v) => v / norm) as [number, number, number];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const r = Math.hypot(x - CX, y - CY);
      // Per-pixel noise made each PNG over 1 MB (noise does not deflate); the draw stays in the sequence so hairlines keep their places.
      random();
      const grain = 0;
      if (r > RADIUS + 1) {
        rgb.set(GROUND, i * 3);
        continue;
      }
      const rim = r > RADIUS - 40 ? 1 - Math.abs(r - (RADIUS - 20)) / 24 : 0;
      const height = (h[i]! * amplitude + Math.max(0, rim) * 0.9) * 60;
      const hx = x + 1 < SIZE ? (h[i + 1]! - h[i]!) * amplitude * 60 : 0;
      const hy = y + 1 < SIZE ? (h[i + SIZE]! - h[i]!) * amplitude * 60 : 0;
      const rimSlope = r > RADIUS - 44 ? ((r - (RADIUS - 20)) / 24) * -0.8 : 0;
      const nx = -hx + rimSlope * ((x - CX) / (r || 1));
      const ny = -hy + rimSlope * ((y - CY) / (r || 1));
      const nl = Math.hypot(nx, ny, 1);
      const diffuse = Math.max(0, (nx * lx + ny * ly + lz) / nl);
      const field = 0.08 * (1 - (r / RADIUS) ** 2);
      const specular = diffuse ** 24 * 0.55;
      const edge = Math.min(1, RADIUS + 1 - r);
      let shade = 0.32 + 0.68 * diffuse + field + specular + height * 0.0012 + grain * 0.006;
      if (worn) shade = shade * 0.82 + 0.06;
      // The rim band at r 410-450 is evenly toned like the register drawings' stroked ring (#6d675c), with no
      // directional light, so its edges sit in the same place on both sides of a wipe divider.
      const band = Math.min(1, Math.max(0, r - (RADIUS - 40) + 0.5));
      shade = shade * (1 - band) + 0.55 * band;
      for (let c = 0; c < 3; c++) {
        const metal = [196, 190, 180][c]! * face.tone[c]!;
        const bg = GROUND[c]!;
        rgb[i * 3 + c] = Math.max(0, Math.min(255, (metal * shade) * edge + bg * (1 - edge)));
      }
    }
  }
  if (worn) hairlines(rgb, random);
  if (face.mark) scar(rgb, face.mark);
  return encodePng(rgb);
}

/** Circulation wear: faint hairlines across the fields, away from the diagnostic point. */
function hairlines(rgb: Buffer, random: () => number): void {
  for (let n = 0; n < 70; n++) {
    const angle = random() * Math.PI;
    const length = 40 + random() * 160;
    const cx = CX + (random() - 0.5) * 640;
    const cy = CY + (random() - 0.5) * 640;
    if (Math.hypot(cx - FEATURE.x, cy - FEATURE.y) < 90 || Math.hypot(cx - CX, cy - CY) > RADIUS - 60) continue;
    for (let t = -length / 2; t <= length / 2; t += 0.7) {
      const i = (Math.round(cy + t * Math.sin(angle)) * SIZE + Math.round(cx + t * Math.cos(angle))) * 3;
      for (let c = 0; c < 3; c++) rgb[i + c] = rgb[i + c]! * 0.86;
    }
  }
}

/** A fine scratch, or a fresh gouge, through the diagnostic point. */
function scar(rgb: Buffer, kind: "scratch" | "gouge"): void {
  const paint = (x: number, y: number, factor: number) => {
    const i = (Math.round(y) * SIZE + Math.round(x)) * 3;
    for (let c = 0; c < 3; c++) rgb[i + c] = Math.max(0, Math.min(255, rgb[i + c]! * factor));
  };
  if (kind === "scratch") {
    for (let t = -110; t <= 110; t += 0.5) {
      const x = FEATURE.x + t * 0.82;
      const y = FEATURE.y + t * 0.57 + Math.sin(t / 9) * 1.5;
      paint(x, y, 0.3);
      paint(x + 0.8, y - 1, 0.45);
      paint(x - 0.8, y + 1, 0.55);
      paint(x - 1.6, y + 2, 1.45);
    }
    return;
  }
  for (let y = -26; y <= 26; y++) {
    for (let x = -34; x <= 34; x++) {
      const d = Math.hypot(x / 34, y / 20 + Math.sin(x / 6) * 0.08);
      if (d < 0.78) paint(FEATURE.x + x, FEATURE.y + y, 0.32 + d * 0.3);
      else if (d < 1) paint(FEATURE.x + x, FEATURE.y + y, 1.45);
    }
  }
}
