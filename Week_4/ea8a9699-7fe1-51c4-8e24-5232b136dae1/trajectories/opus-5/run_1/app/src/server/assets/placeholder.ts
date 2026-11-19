import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = -1;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  header.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), payload])), 0);
  return Buffer.concat([header, payload, crc]);
}

function hueToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (hue % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const base = lightness - chroma / 2;
  const table: [number, number, number][] = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ];
  const [red, green, blue] = table[Math.floor(sector) % 6];
  return [
    Math.round((red + base) * 255),
    Math.round((green + base) * 255),
    Math.round((blue + base) * 255),
  ];
}

interface PlaceholderShape {
  width: number;
  height: number;
}

const shapes: PlaceholderShape[] = [
  { width: 360, height: 480 },
  { width: 360, height: 270 },
  { width: 360, height: 360 },
  { width: 360, height: 540 },
];

function placeholderShape(seed: string): PlaceholderShape {
  const digest = createHash('sha256').update(seed).digest();
  return shapes[digest[0] % shapes.length];
}

/** A small generated placeholder PNG with no metadata chunks, used for the seeded image references. */
export function placeholderPng(seed: string): Buffer {
  const digest = createHash('sha256').update(seed).digest();
  const { width, height } = placeholderShape(seed);
  const hue = (digest[1] / 255) * 360;
  const bandTop = Math.floor((height * (0.3 + (digest[2] / 255) * 0.4)) / 1);
  const bandHeight = Math.max(6, Math.floor(height * 0.06));
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    const vertical = y / height;
    for (let x = 0; x < width; x += 1) {
      const horizontal = x / width;
      const lightness = 0.18 + vertical * 0.26 + horizontal * 0.06;
      const inBand = y >= bandTop && y < bandTop + bandHeight;
      const [red, green, blue] = inBand
        ? hueToRgb(hue + 24, 0.5, 0.62)
        : hueToRgb(hue, 0.28, lightness);
      raw[offset] = red;
      raw[offset + 1] = green;
      raw[offset + 2] = blue;
      offset += 3;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
