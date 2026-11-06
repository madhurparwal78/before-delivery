import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes 8-bit RGB pixel rows as a PNG. */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // no filter
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decodes an 8-bit RGB or RGBA, non-interlaced PNG (what encodePng writes) to RGB rows. */
export function decodePng(png: Buffer): { width: number; height: number; rgb: Buffer } | null {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) return null;
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0;
      if (channels === 0) return null;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (width === 0 || height === 0) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[src + x] ?? 0;
      const a = x >= channels ? (rows[dst + x - channels] ?? 0) : 0;
      const b = y > 0 ? (rows[dst - stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (rows[dst - stride + x - channels] ?? 0) : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[dst + x] = (value + predictor) & 0xff;
    }
  }
  if (channels === 3) return { width, height, rgb: rows };
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = rows[i * 4] ?? 0;
    rgb[i * 3 + 1] = rows[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = rows[i * 4 + 2] ?? 0;
  }
  return { width, height, rgb };
}

/** Halves a PNG in each dimension by averaging 2x2 blocks; null when it cannot be read. */
export function halvePng(png: Buffer): Buffer | null {
  const image = decodePng(png);
  if (image === null) return null;
  const width = Math.max(1, Math.floor(image.width / 2));
  const height = Math.max(1, Math.floor(image.height / 2));
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        const at = (yy: number, xx: number): number => image.rgb[(yy * image.width + xx) * 3 + ch] ?? 0;
        const x0 = x * 2;
        const y0 = y * 2;
        const x1 = Math.min(x0 + 1, image.width - 1);
        const y1 = Math.min(y0 + 1, image.height - 1);
        out[(y * width + x) * 3 + ch] = (at(y0, x0) + at(y0, x1) + at(y1, x0) + at(y1, x1) + 2) >> 2;
      }
    }
  }
  return encodePng(width, height, out);
}
