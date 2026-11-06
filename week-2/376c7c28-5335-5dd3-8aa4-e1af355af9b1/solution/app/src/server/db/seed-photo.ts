import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
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
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const WIDTH = 480;
const HEIGHT = 360;
const GRID_PX = 24;
const PX_PER_INCH = 20;

type Rgb = readonly [number, number, number];

const BOARD: Rgb = [214, 205, 192];
const GRID: Rgb = [184, 171, 156];
const GRID_INCH: Rgb = [150, 136, 121];
const SHADOWED: Rgb = [196, 186, 172];

/** Raw greenware colours for the seeded clay bodies; any other clay reads as buff. */
const CLAY_COLOURS: Record<string, Rgb> = {
  'Buff Stoneware': [201, 170, 128],
  'Speckled Stoneware': [190, 172, 146],
  Porcelain: [236, 232, 224],
  'Red Earthenware': [166, 86, 52],
  'Dark Stoneware': [92, 76, 66],
};

interface SeedPhotoPiece {
  readonly id: string;
  readonly clayBody: string;
  readonly widthIn: number;
  readonly heightIn: number;
}

/**
 * The intake photo the app draws for a seeded piece: the piece's front profile, to scale and in
 * its clay colour, standing on the gridded measuring board a tech photographs pieces against.
 */
export function seedPhoto(piece: SeedPhotoPiece): Buffer {
  const seed = createHash('sha256').update(piece.id).digest();
  const clay = CLAY_COLOURS[piece.clayBody] ?? (CLAY_COLOURS['Buff Stoneware'] as Rgb);
  const speckled = piece.clayBody === 'Speckled Stoneware';
  const scale = Math.min(PX_PER_INCH, (WIDTH - 80) / piece.widthIn, (HEIGHT - 80) / piece.heightIn);
  const bodyW = Math.round(piece.widthIn * scale);
  const bodyH = Math.round(piece.heightIn * scale);
  const floor = HEIGHT - 40;
  const left = Math.round((WIDTH - bodyW) / 2);
  const top = floor - bodyH;
  const footInset = Math.round(bodyW * 0.12);

  const inside = (x: number, y: number): boolean => {
    if (y < top || y >= floor) return false;
    // The profile narrows towards the foot, like a thrown pot.
    const t = (y - top) / Math.max(1, bodyH);
    const inset = t > 0.8 ? footInset * ((t - 0.8) / 0.2) : 0;
    return x >= left + inset && x < left + bodyW - inset;
  };

  const scanlines: Buffer[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = Buffer.alloc(1 + WIDTH * 3);
    for (let x = 0; x < WIDTH; x += 1) {
      let colour: Rgb = BOARD;
      if (x % GRID_PX === 0 || y % GRID_PX === 0) {
        colour = (x / GRID_PX) % 4 === 0 || (y / GRID_PX) % 4 === 0 ? GRID_INCH : GRID;
      }
      if (y >= floor && y < floor + 6 && x > left - 10 && x < left + bodyW + 18) colour = SHADOWED;
      if (inside(x, y)) {
        // Light from the left: the body darkens across its width.
        const shade = 1 - 0.22 * ((x - left) / Math.max(1, bodyW));
        const scatter = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ seed.readInt32BE(0)) >>> 0;
        const fleck = speckled && scatter % 41 === 0;
        colour = fleck
          ? [70, 58, 50]
          : [Math.round(clay[0] * shade), Math.round(clay[1] * shade), Math.round(clay[2] * shade)];
      }
      const offset = 1 + x * 3;
      row[offset] = colour[0];
      row[offset + 1] = colour[1];
      row[offset + 2] = colour[2];
    }
    scanlines.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(scanlines))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
