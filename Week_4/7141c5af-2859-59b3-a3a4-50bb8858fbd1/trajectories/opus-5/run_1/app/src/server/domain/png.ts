/**
 * A small PNG writer and the procedural photographs the seed stores. No image
 * from outside the repository is ever copied in.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

/** An 8-bit greyscale PNG. `grey` holds one byte per pixel, row by row. */
export function writeGreyscalePng(width: number, height: number, grey: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    raw.set(grey.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 0;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** A small deterministic generator, so a copy's seed is the same every time. */
function generator(seedText: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

const WIDTH = 480;
const HEIGHT = 360;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A generated photograph of an invented chair: a dot-grain ground with the
 * chair's frame and cover drawn over it. `after` reads as a finished cover.
 */
export function generatePhotograph(pieceTitle: string, side: 'before' | 'after'): Uint8Array {
  const random = generator(`${pieceTitle}|${side}`);
  const grey = new Uint8Array(WIDTH * HEIGHT);

  // Ground: a soft vertical fall with dot grain over it.
  for (let y = 0; y < HEIGHT; y += 1) {
    const base = 238 - Math.round((y / HEIGHT) * 26);
    for (let x = 0; x < WIDTH; x += 1) {
      const grain = random() < 0.08 ? -10 - Math.round(random() * 12) : 0;
      grey[y * WIDTH + x] = Math.max(0, Math.min(255, base + grain));
    }
  }

  const fill = (rect: Rect, tone: number, density: number): void => {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      if (y < 0 || y >= HEIGHT) continue;
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        if (x < 0 || x >= WIDTH) continue;
        const dotted = random() < density ? tone - 18 : tone;
        grey[y * WIDTH + x] = Math.max(0, Math.min(255, dotted));
      }
    }
  };

  // The cover is even and tight after the work, broken and loose before it.
  const coverTone = side === 'after' ? 120 : 168;
  const coverDensity = side === 'after' ? 0.3 : 0.14;
  const frameTone = 74;

  const seat: Rect = { x: 120, y: 170, w: 240, h: 54 };
  const back: Rect = { x: 142, y: 66, w: 196, h: 104 };
  fill(back, coverTone, coverDensity);
  fill(seat, coverTone, coverDensity);

  fill({ x: 128, y: 224, w: 16, h: 104 }, frameTone, 0.2);
  fill({ x: 336, y: 224, w: 16, h: 104 }, frameTone, 0.2);
  fill({ x: 142, y: 58, w: 196, h: 10 }, frameTone, 0.2);
  fill({ x: 120, y: 218, w: 240, h: 10 }, frameTone, 0.2);

  if (side === 'before') {
    // Tears and a loose joint read as breaks in the cover.
    for (let i = 0; i < 5; i += 1) {
      const x = seat.x + Math.round(random() * (seat.w - 30));
      const y = seat.y + Math.round(random() * (seat.h - 6));
      fill({ x, y, w: 2 + Math.round(random() * 26), h: 2 }, 96, 0.5);
    }
    fill({ x: back.x + 24, y: back.y + 30, w: 34, h: 3 }, 96, 0.5);
  }

  return writeGreyscalePng(WIDTH, HEIGHT, grey);
}
