import { inflateSync } from 'node:zlib';

export type ImageFault = 'not_png' | 'trailing_data' | 'animated' | 'bad_dimensions' | 'bad_image_data';

export interface SoundImage {
  width: number;
  height: number;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_SIDE = 320;
const MAX_SIDE = 2048;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const LEGAL_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

const ADAM7 = [
  { xStart: 0, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 4, yStart: 0, xStep: 8, yStep: 8 },
  { xStart: 0, yStart: 4, xStep: 4, yStep: 8 },
  { xStart: 2, yStart: 0, xStep: 4, yStep: 4 },
  { xStart: 0, yStart: 2, xStep: 2, yStep: 4 },
  { xStart: 1, yStart: 0, xStep: 2, yStep: 2 },
  { xStart: 0, yStart: 1, xStep: 1, yStep: 2 },
];

interface Chunk {
  type: string;
  data: Buffer;
}

interface Scanlines {
  rows: number;
  bytesPerRow: number;
}

function passes(
  width: number,
  height: number,
  channels: number,
  bitDepth: number,
  interlaced: boolean,
): Scanlines[] {
  const lineBytes = (cols: number): number => Math.ceil((cols * channels * bitDepth) / 8);
  if (!interlaced) return [{ rows: height, bytesPerRow: lineBytes(width) }];
  const out: Scanlines[] = [];
  for (const pass of ADAM7) {
    const cols = Math.ceil((width - pass.xStart) / pass.xStep);
    const rows = Math.ceil((height - pass.yStart) / pass.yStep);
    if (cols > 0 && rows > 0) out.push({ rows, bytesPerRow: lineBytes(cols) });
  }
  return out;
}

function typeIsLetters(bytes: Buffer): boolean {
  for (const byte of bytes) {
    const upper = byte >= 0x41 && byte <= 0x5a;
    const lower = byte >= 0x61 && byte <= 0x7a;
    if (!upper && !lower) return false;
  }
  return true;
}

const CRITICAL_ALLOWED = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);
const ANIMATION_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT']);

/**
 * Walks every chunk up to the first IEND and inflates the image data, so only a structurally
 * sound, still PNG of the stated size is ever stored. The first failed check decides the reason.
 */
export function inspectPng(body: Buffer): SoundImage | { fault: ImageFault } {
  if (body.length < SIGNATURE.length || !body.subarray(0, 8).equals(SIGNATURE)) {
    return { fault: 'not_png' };
  }
  const chunks: Chunk[] = [];
  let offset = 8;
  let endOfImage = -1;
  while (offset < body.length) {
    if (offset + 8 > body.length) return { fault: 'not_png' };
    const length = body.readUInt32BE(offset);
    const typeBytes = body.subarray(offset + 4, offset + 8);
    if (!typeIsLetters(typeBytes)) return { fault: 'not_png' };
    const type = typeBytes.toString('latin1');
    if (length > body.length || offset + 12 + length > body.length) return { fault: 'not_png' };
    const data = body.subarray(offset + 8, offset + 8 + length);
    const declared = body.readUInt32BE(offset + 8 + length);
    if (crc32(body.subarray(offset + 4, offset + 8 + length)) !== declared) {
      return { fault: 'not_png' };
    }
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') {
      endOfImage = offset;
      break;
    }
  }

  const header = chunks[0];
  if (!header || header.type !== 'IHDR' || header.data.length !== 13) return { fault: 'not_png' };
  if (chunks.slice(1).some((chunk) => chunk.type === 'IHDR')) return { fault: 'not_png' };
  if (endOfImage < 0) return { fault: 'not_png' };
  for (const chunk of chunks) {
    const critical = chunk.type.charCodeAt(0) >= 0x41 && chunk.type.charCodeAt(0) <= 0x5a;
    if (critical && !CRITICAL_ALLOWED.has(chunk.type)) return { fault: 'not_png' };
  }
  const idatIndexes = chunks.flatMap((chunk, index) => (chunk.type === 'IDAT' ? [index] : []));
  if (idatIndexes.length === 0) return { fault: 'not_png' };
  const first = idatIndexes[0]!;
  if (idatIndexes.some((index, step) => index !== first + step)) return { fault: 'not_png' };

  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const bitDepth = header.data.readUInt8(8);
  const colourType = header.data.readUInt8(9);
  const compression = header.data.readUInt8(10);
  const filter = header.data.readUInt8(11);
  const interlace = header.data.readUInt8(12);

  const depths = LEGAL_DEPTHS[colourType];
  if (!depths || !depths.includes(bitDepth)) return { fault: 'not_png' };
  if (compression !== 0 || filter !== 0 || interlace > 1) return { fault: 'not_png' };

  const paletteIndexes = chunks.flatMap((chunk, index) => (chunk.type === 'PLTE' ? [index] : []));
  if (colourType === 3 && paletteIndexes.length !== 1) return { fault: 'not_png' };
  if ((colourType === 0 || colourType === 4) && paletteIndexes.length > 0) {
    return { fault: 'not_png' };
  }
  if (paletteIndexes.length > 1) return { fault: 'not_png' };
  const paletteIndex = paletteIndexes[0];
  if (paletteIndex !== undefined) {
    if (paletteIndex > first) return { fault: 'not_png' };
    const size = chunks[paletteIndex]!.data.length;
    if (size % 3 !== 0 || size < 3 || size > 768) return { fault: 'not_png' };
  }

  if (endOfImage < body.length) return { fault: 'trailing_data' };
  if (chunks.some((chunk) => ANIMATION_CHUNKS.has(chunk.type))) return { fault: 'animated' };
  if (width < MIN_SIDE || width > MAX_SIDE || height < MIN_SIDE || height > MAX_SIDE) {
    return { fault: 'bad_dimensions' };
  }

  const channels = CHANNELS[colourType]!;
  const layout = passes(width, height, channels, bitDepth, interlace === 1);
  const expected = layout.reduce((sum, pass) => sum + pass.rows * (1 + pass.bytesPerRow), 0);
  const compressed = Buffer.concat(idatIndexes.map((index) => chunks[index]!.data));
  let raw: Buffer;
  try {
    raw = inflateSync(compressed, { maxOutputLength: expected + 1 });
  } catch {
    return { fault: 'bad_image_data' };
  }
  if (raw.length !== expected) return { fault: 'bad_image_data' };
  let cursor = 0;
  for (const pass of layout) {
    for (let row = 0; row < pass.rows; row += 1) {
      if (raw[cursor]! > 4) return { fault: 'bad_image_data' };
      cursor += 1 + pass.bytesPerRow;
    }
  }
  return { width, height };
}
