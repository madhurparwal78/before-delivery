import { deflateSync } from 'node:zlib';

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};

interface Canvas {
  width: number;
  height: number;
  pixels: Buffer;
}

const makeCanvas = (width: number, height: number, colour: [number, number, number]): Canvas => {
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 3] = colour[0];
    pixels[index * 3 + 1] = colour[1];
    pixels[index * 3 + 2] = colour[2];
  }
  return { width, height, pixels };
};

const plot = (canvas: Canvas, x: number, y: number, colour: [number, number, number]): void => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const index = (Math.floor(y) * canvas.width + Math.floor(x)) * 3;
  canvas.pixels[index] = colour[0];
  canvas.pixels[index + 1] = colour[1];
  canvas.pixels[index + 2] = colour[2];
};

const stroke = (
  canvas: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: [number, number, number],
): void => {
  const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))) + 1;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    plot(canvas, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, colour);
  }
};

const encode = (canvas: Canvas): Buffer => {
  const raw = Buffer.alloc(canvas.height * (canvas.width * 3 + 1));
  for (let y = 0; y < canvas.height; y += 1) {
    const target = y * (canvas.width * 3 + 1);
    raw[target] = 0;
    canvas.pixels.copy(raw, target + 1, y * canvas.width * 3, (y + 1) * canvas.width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const INK: [number, number, number] = [214, 228, 240];
const GROUND: [number, number, number] = [16, 48, 86];
const FAINT: [number, number, number] = [38, 78, 122];

/** A procedural blueprint-style line drawing, seeded from the file name. */
export const blueprintPng = (seedText: string): Buffer => {
  const canvas = makeCanvas(480, 320, GROUND);
  let seed = 0;
  for (const code of seedText) seed = (seed * 31 + code.charCodeAt(0)) % 100_000;
  const random = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };

  for (let x = 0; x < canvas.width; x += 20) stroke(canvas, x, 0, x, canvas.height, FAINT);
  for (let y = 0; y < canvas.height; y += 20) stroke(canvas, 0, y, canvas.width, y, FAINT);

  stroke(canvas, 16, 16, canvas.width - 16, 16, INK);
  stroke(canvas, 16, canvas.height - 16, canvas.width - 16, canvas.height - 16, INK);
  stroke(canvas, 16, 16, 16, canvas.height - 16, INK);
  stroke(canvas, canvas.width - 16, 16, canvas.width - 16, canvas.height - 16, INK);

  const baseY = canvas.height - 70;
  stroke(canvas, 48, baseY, canvas.width - 48, baseY, INK);
  for (let column = 0; column < 5; column += 1) {
    const x = 70 + column * 80;
    const top = baseY - 60 - Math.floor(random() * 90);
    stroke(canvas, x, baseY, x, top, INK);
    stroke(canvas, x - 10, top, x + 10, top, INK);
    stroke(canvas, x, top, x + 40, top - 20, INK);
  }
  for (let hatch = 0; hatch < 24; hatch += 1) {
    const x = 48 + hatch * 16;
    stroke(canvas, x, baseY + 4, x - 10, baseY + 18, INK);
  }
  return encode(canvas);
};
