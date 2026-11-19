import { crc32, deflateSync } from "node:zlib";

// The seeded covers: flat teal-on-paper halftone prints drawn here at first start (brief: Seed data).

const PAPER = [0xee, 0xf4, 0xf1];
const INK = [0x0c, 0x4e, 0x4f];
const WIDTH = 600;
const HEIGHT = 800;
const PITCH = 22;
const ROW = PITCH * Math.sqrt(3) / 2;

/** Ink tone 0..1 at a point; the halftone screen turns it into dots. */
type Tone = (x: number, y: number) => number;

export const COVER_TONES: Record<string, Tone> = {
  // A low moon over the marsh: a solid disc whose edge breaks into a ramp, above banded reeds.
  saltmarsh: (x, y) => {
    const d = Math.hypot(x - 380, y - 300) - 170;
    const moon = d <= 0 ? 1 : Math.max(0, 1 - d / 120);
    const marsh = y > 560 ? Math.min(1, (y - 560) / 160) * (0.55 + 0.45 * Math.abs(Math.sin(x / 47))) : 0;
    return Math.max(moon, marsh);
  },
  // A folded sheet: solid below the diagonal fold, a ramp fading away above it.
  fold: (x, y) => {
    const d = (x + y - 760) / Math.SQRT2;
    return d >= 0 ? 1 : Math.max(0, 1 + d / 260);
  },
};

function inked(tone: Tone, x: number, y: number): boolean {
  const row = Math.round(y / ROW);
  for (const r of [row - 1, row, row + 1]) {
    const shift = r % 2 ? PITCH / 2 : 0;
    const col = Math.round((x - shift) / PITCH);
    for (const c of [col - 1, col, col + 1]) {
      const cx = c * PITCH + shift;
      const cy = r * ROW;
      const t = Math.min(1, Math.max(0, tone(cx, cy)));
      const radius = (PITCH * 1.155 * Math.sqrt(t)) / 2;
      if (t > 0 && Math.hypot(x - cx, y - cy) <= radius) return true;
    }
  }
  return false;
}

function chunk(tag: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(tag, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

export function coverPng(tone: Tone): Buffer {
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const offset = y * (WIDTH * 3 + 1);
    for (let x = 0; x < WIDTH; x++) {
      const colour = inked(tone, x, y) ? INK : PAPER;
      raw.set(colour, offset + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
