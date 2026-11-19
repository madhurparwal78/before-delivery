import { deflateSync } from 'node:zlib';
import { crc32 } from './crc32.ts';

/**
 * Fixture photographs are procedurally drawn 1000x1000 coins with legible rims,
 * distinct mintmark letters and a visible scratch. The diagnostic feature sits
 * at original-image coordinate (600,400): the mintmark letter, a fine scratch
 * through it on a condition photograph, and a fresh gouge on a disputed arrival.
 *
 * PNG encoding is written out directly so no image dependency ships.
 */

export const COIN_SIZE = 1000;
export const FEATURE_X = 600;
export const FEATURE_Y = 400;

type Rgb = [number, number, number];

interface Canvas {
  width: number;
  height: number;
  pixels: Uint8Array; // RGB, row-major
}

function makeCanvas(width: number, height: number, fill: Rgb): Canvas {
  const pixels = new Uint8Array(width * height * 3);
  for (let at = 0; at < pixels.length; at += 3) {
    pixels[at] = fill[0];
    pixels[at + 1] = fill[1];
    pixels[at + 2] = fill[2];
  }
  return { width, height, pixels };
}

function blend(canvas: Canvas, x: number, y: number, colour: Rgb, alpha: number): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || alpha <= 0) return;
  const at = (y * canvas.width + x) * 3;
  const keep = 1 - Math.min(1, alpha);
  canvas.pixels[at] = Math.round((canvas.pixels[at] as number) * keep + colour[0] * Math.min(1, alpha));
  canvas.pixels[at + 1] = Math.round(
    (canvas.pixels[at + 1] as number) * keep + colour[1] * Math.min(1, alpha),
  );
  canvas.pixels[at + 2] = Math.round(
    (canvas.pixels[at + 2] as number) * keep + colour[2] * Math.min(1, alpha),
  );
}

function fillDisc(canvas: Canvas, cx: number, cy: number, radius: number, colour: Rgb): void {
  const from = Math.max(0, Math.floor(cy - radius));
  const to = Math.min(canvas.height - 1, Math.ceil(cy + radius));
  for (let y = from; y <= to; y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(canvas.width - 1, Math.ceil(cx + radius)); x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius - 1) blend(canvas, x, y, colour, 1);
      else if (distance <= radius) blend(canvas, x, y, colour, radius - distance);
    }
  }
}

function strokeRing(
  canvas: Canvas,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  colour: Rgb,
): void {
  const outer = radius + width / 2;
  const inner = radius - width / 2;
  const from = Math.max(0, Math.floor(cy - outer));
  const to = Math.min(canvas.height - 1, Math.ceil(cy + outer));
  for (let y = from; y <= to; y += 1) {
    for (let x = Math.max(0, Math.floor(cx - outer)); x <= Math.min(canvas.width - 1, Math.ceil(cx + outer)); x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance >= inner && distance <= outer) blend(canvas, x, y, colour, 1);
    }
  }
}

function strokeLine(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  colour: Rgb,
): void {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const radius = width / 2;
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx += 1) {
        const distance = Math.hypot(dx, dy);
        if (distance <= radius) {
          blend(canvas, Math.round(cx + dx), Math.round(cy + dy), colour, 1 - distance / (radius + 1));
        }
      }
    }
  }
}

/** Reeded edge: short radial ticks around the rim, so the rim reads clearly. */
function reedRim(canvas: Canvas, cx: number, cy: number, radius: number, colour: Rgb): void {
  const teeth = 120;
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const angle = (tooth / teeth) * Math.PI * 2;
    const x0 = cx + Math.cos(angle) * (radius - 16);
    const y0 = cy + Math.sin(angle) * (radius - 16);
    const x1 = cx + Math.cos(angle) * (radius + 2);
    const y1 = cy + Math.sin(angle) * (radius + 2);
    strokeLine(canvas, x0, y0, x1, y1, 5, colour);
  }
}

/* -- a compact stroke alphabet for mintmark letters and legends ---------- */

type Stroke = [number, number, number, number];

const GLYPHS: Record<string, Stroke[]> = {
  A: [[0.5, 0, 0, 1], [0.5, 0, 1, 1], [0.2, 0.62, 0.8, 0.62]],
  B: [[0, 0, 0, 1], [0, 0, 0.8, 0.16], [0.8, 0.16, 0, 0.5], [0, 0.5, 0.85, 0.68], [0.85, 0.68, 0, 1]],
  C: [[0.95, 0.12, 0.2, 0.05], [0.2, 0.05, 0, 0.5], [0, 0.5, 0.2, 0.95], [0.2, 0.95, 0.95, 0.88]],
  D: [[0, 0, 0, 1], [0, 0, 0.75, 0.25], [0.75, 0.25, 0.75, 0.75], [0.75, 0.75, 0, 1]],
  E: [[0, 0, 0, 1], [0, 0, 0.9, 0], [0, 0.5, 0.75, 0.5], [0, 1, 0.9, 1]],
  K: [[0, 0, 0, 1], [0.85, 0, 0, 0.52], [0, 0.52, 0.9, 1]],
  L: [[0, 0, 0, 1], [0, 1, 0.85, 1]],
  M: [[0, 1, 0, 0], [0, 0, 0.5, 0.55], [0.5, 0.55, 1, 0], [1, 0, 1, 1]],
  N: [[0, 1, 0, 0], [0, 0, 1, 1], [1, 1, 1, 0]],
  O: [[0.5, 0, 0, 0.3], [0, 0.3, 0, 0.7], [0, 0.7, 0.5, 1], [0.5, 1, 1, 0.7], [1, 0.7, 1, 0.3], [1, 0.3, 0.5, 0]],
  R: [[0, 0, 0, 1], [0, 0, 0.8, 0.18], [0.8, 0.18, 0, 0.52], [0, 0.52, 0.9, 1]],
  S: [[0.9, 0.1, 0.15, 0.04], [0.15, 0.04, 0.1, 0.42], [0.1, 0.42, 0.85, 0.56], [0.85, 0.56, 0.82, 0.95], [0.82, 0.95, 0.05, 0.9]],
  W: [[0, 0, 0.22, 1], [0.22, 1, 0.5, 0.35], [0.5, 0.35, 0.78, 1], [0.78, 1, 1, 0]],
  '1': [[0.25, 0.2, 0.55, 0], [0.55, 0, 0.55, 1], [0.2, 1, 0.9, 1]],
  '9': [[0.9, 0.45, 0.4, 0.5], [0.4, 0.5, 0.25, 0.2], [0.25, 0.2, 0.7, 0.03], [0.7, 0.03, 0.92, 0.3], [0.92, 0.3, 0.6, 1]],
  '-': [[0.1, 0.5, 0.9, 0.5]],
  ' ': [],
};

function drawGlyph(
  canvas: Canvas,
  glyph: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  colour: Rgb,
): void {
  const strokes = GLYPHS[glyph.toUpperCase()];
  if (!strokes) return;
  for (const [x0, y0, x1, y1] of strokes) {
    strokeLine(
      canvas,
      x + x0 * size * 0.62,
      y + y0 * size,
      x + x1 * size * 0.62,
      y + y1 * size,
      weight,
      colour,
    );
  }
}

function drawText(
  canvas: Canvas,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  colour: Rgb,
): void {
  let cursor = x;
  for (const glyph of text) {
    drawGlyph(canvas, glyph, cursor, y, size, weight, colour);
    cursor += size * 0.78;
  }
}

/* -- PNG encoding -------------------------------------------------------- */

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
}

export function encodePng(canvas: Canvas): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = canvas.width * 3;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    raw[y * (stride + 1)] = 0; // no filter
    Buffer.from(canvas.pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -- the coin itself ----------------------------------------------------- */

export type CoinOverlay = 'none' | 'scratch' | 'gouge';

export interface CoinOptions {
  mintmark: string;
  face: 'obverse' | 'reverse';
  /** Heavier wear draws a flatter relief, so two duplicates compare visibly. */
  wear?: number;
  overlay?: CoinOverlay;
  legend?: string;
}

const GROUND: Rgb = [0xd9, 0xd6, 0xcf];
const FIELD: Rgb = [0xb8, 0xb2, 0xa6];
const RIM: Rgb = [0x6d, 0x67, 0x5c];
const RELIEF: Rgb = [0x4a, 0x45, 0x3d];
const HIGHLIGHT: Rgb = [0xd2, 0xcc, 0xc0];
const SCRATCH: Rgb = [0xf2, 0xef, 0xe8];
const GOUGE: Rgb = [0x3a, 0x2f, 0x25];

/**
 * Draws one coin face. The mintmark letter is centred on (600,400) so markers
 * and captions anchored to that coordinate land on the feature they name.
 */
export function drawCoin(options: CoinOptions): Buffer {
  const canvas = makeCanvas(COIN_SIZE, COIN_SIZE, GROUND);
  const centre = COIN_SIZE / 2;
  const wear = Math.min(1, Math.max(0, options.wear ?? 0));

  fillDisc(canvas, centre, centre, 430, FIELD);
  strokeRing(canvas, centre, centre, 430, 40, RIM);
  // The reeding is drawn over the rim band so the milled edge stays readable.
  reedRim(canvas, centre, centre, 448, [0x55, 0x50, 0x47]);
  strokeRing(canvas, centre, centre, 360, 6, [
    Math.round(0x8a + wear * 20),
    Math.round(0x84 + wear * 20),
    Math.round(0x78 + wear * 20),
  ]);

  // A flatter relief on a worn specimen: the ink lightens towards the field.
  const relief: Rgb = [
    Math.round(RELIEF[0] + (FIELD[0] - RELIEF[0]) * wear * 0.75),
    Math.round(RELIEF[1] + (FIELD[1] - RELIEF[1]) * wear * 0.75),
    Math.round(RELIEF[2] + (FIELD[2] - RELIEF[2]) * wear * 0.75),
  ];

  if (options.face === 'obverse') {
    // A portrait reads as a raised disc with a shaded cheek line. It is held
    // clear of (600,400) so the mintmark stays the diagnostic feature.
    fillDisc(canvas, centre - 110, centre + 60, 175, [
      Math.round(FIELD[0] - 12),
      Math.round(FIELD[1] - 12),
      Math.round(FIELD[2] - 12),
    ]);
    strokeRing(canvas, centre - 110, centre + 60, 175, 10, relief);
    strokeLine(canvas, centre - 185, centre - 20, centre - 80, centre + 110, 14, relief);
    strokeLine(canvas, centre - 210, centre + 150, centre - 20, centre + 180, 10, relief);
  } else {
    // A wreath reads as two arcs of short ticks.
    for (let tick = 0; tick < 26; tick += 1) {
      const angle = Math.PI * 0.25 + (tick / 26) * Math.PI * 1.5;
      const x0 = centre + Math.cos(angle) * 250;
      const y0 = centre + Math.sin(angle) * 250;
      const x1 = centre + Math.cos(angle) * 300;
      const y1 = centre + Math.sin(angle) * 300;
      strokeLine(canvas, x0, y0, x1, y1, 12, relief);
    }
    // The legend sits below the mintmark so (600,400) stays uncluttered.
    drawText(canvas, options.legend ?? 'ALDMERE', centre - 215, centre + 160, 70, 12, relief);
  }

  // The mintmark letter, centred on the diagnostic coordinate.
  const markSize = 150;
  drawGlyph(
    canvas,
    options.mintmark,
    FEATURE_X - markSize * 0.31,
    FEATURE_Y - markSize / 2,
    markSize,
    18,
    RELIEF,
  );
  // A light shoulder makes the punch details legible at every zoom step.
  drawGlyph(
    canvas,
    options.mintmark,
    FEATURE_X - markSize * 0.31 + 5,
    FEATURE_Y - markSize / 2 + 5,
    markSize,
    6,
    HIGHLIGHT,
  );

  if (options.overlay === 'scratch') {
    strokeLine(canvas, FEATURE_X - 150, FEATURE_Y - 90, FEATURE_X + 150, FEATURE_Y + 95, 7, SCRATCH);
  }
  if (options.overlay === 'gouge') {
    // The gouge crosses the mintmark but is kept narrow enough that the letter
    // underneath can still be judged against the dispatch photograph.
    strokeLine(canvas, FEATURE_X - 60, FEATURE_Y + 10, FEATURE_X + 120, FEATURE_Y + 120, 20, GOUGE);
    strokeLine(canvas, FEATURE_X - 50, FEATURE_Y + 24, FEATURE_X + 100, FEATURE_Y + 116, 7, SCRATCH);
  }

  return encodePng(canvas);
}
