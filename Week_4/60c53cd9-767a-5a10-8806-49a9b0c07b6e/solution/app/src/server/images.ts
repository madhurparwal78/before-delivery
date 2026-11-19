/** Structural PNG and JPEG checks: signature, dimensions, and enough of the stream to know it decodes. */
import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export type ImageKind = "png" | "jpg";

export const kindFromSignature = (bytes: Buffer): ImageKind | null => {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (bytes.subarray(0, 3).equals(JPEG_SIGNATURE)) return "jpg";
  return null;
};

export const CONTENT_TYPE: Readonly<Record<ImageKind, string>> = { png: "image/png", jpg: "image/jpeg" };

interface Dimensions {
  readonly width: number;
  readonly height: number;
}

const crc32 = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return (data: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of data) crc = (table[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
})();

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Bytes of filtered scanline data a non-interlaced or Adam7 image inflates to. */
const expectedPngBytes = (width: number, height: number, bitDepth: number, colour: number, interlaced: boolean): number => {
  const bitsPerPixel = (CHANNELS[colour] ?? 0) * bitDepth;
  const rows = (w: number, h: number): number => (w === 0 || h === 0 ? 0 : h * (1 + Math.ceil((w * bitsPerPixel) / 8)));
  if (!interlaced) return rows(width, height);
  const passes: [number, number, number, number][] = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  return passes.reduce(
    (sum, [x0, y0, dx, dy]) => sum + rows(Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)),
    0,
  );
};

const readPng = (bytes: Buffer): Dimensions | null => {
  let offset = 8;
  let header: { width: number; height: number; depth: number; colour: number; interlaced: boolean } | null = null;
  const idat: Buffer[] = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (dataStart + length + 4 > bytes.length) return null;
    const body = bytes.subarray(dataStart, dataStart + length);
    if (crc32(bytes.subarray(offset + 4, dataStart + length)) !== bytes.readUInt32BE(dataStart + length)) return null;
    if (type === "IHDR") {
      if (length !== 13) return null;
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body.readUInt8(8),
        colour: body.readUInt8(9),
        interlaced: body.readUInt8(12) === 1,
      };
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      ended = true;
      break;
    }
    offset = dataStart + length + 4;
  }
  if (!header || !ended || idat.length === 0 || header.width === 0 || header.height === 0) return null;
  if (!(header.colour in CHANNELS)) return null;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  if (raw.length !== expectedPngBytes(header.width, header.height, header.depth, header.colour, header.interlaced)) return null;
  return { width: header.width, height: header.height };
};

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const readJpeg = (bytes: Buffer): Dimensions | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let dimensions: Dimensions | null = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1] as number;
    while (marker === 0xff) {
      offset += 1;
      marker = bytes[offset + 1] as number;
    }
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if (SOF_MARKERS.has(marker)) {
      if (length < 8) return null;
      dimensions = { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xda) {
      if (!dimensions || dimensions.width === 0 || dimensions.height === 0) return null;
      const tail = bytes.subarray(offset + 2 + length);
      return tail.includes(Buffer.from([0xff, 0xd9])) && tail.length > 2 ? dimensions : null;
    }
    offset += 2 + length;
  }
  return null;
};

/** Dimensions when the bytes form a complete, readable image of the detected kind; otherwise null. */
export const readImage = (bytes: Buffer, kind: ImageKind): Dimensions | null => (kind === "png" ? readPng(bytes) : readJpeg(bytes));

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

/**
 * A smaller copy of an 8-bit, non-interlaced RGB or RGBA PNG, averaged over source pixels and never larger than the source.
 * Null for anything else (JPEG, other PNG layouts, undecodable bytes): the caller then serves the stored bytes.
 */
export const scalePng = (bytes: Buffer, targetWidth: number): Buffer | null => {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE) || readPng(bytes) === null) return null;
  let width = 0;
  let height = 0;
  let colour = -1;
  const idat: Buffer[] = [];
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      if (body.readUInt8(8) !== 8 || body.readUInt8(12) !== 0) return null;
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colour = body.readUInt8(9);
    } else if (type === "IDAT") {
      idat.push(body);
    }
    offset += 12 + length;
  }
  if ((colour !== 2 && colour !== 6) || targetWidth >= width) return null;
  const channels = colour === 2 ? 3 : 4;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (pixels[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] as number) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] as number) : 0;
      const value = raw[y * (stride + 1) + 1 + x] as number;
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : filter === 4 ? paeth(left, up, upLeft) : 0;
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  const outWidth = targetWidth;
  const outHeight = Math.max(1, Math.round((height * outWidth) / width));
  const out = Buffer.alloc((outWidth * channels + 1) * outHeight);
  for (let oy = 0; oy < outHeight; oy += 1) {
    const y0 = Math.floor((oy * height) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outHeight));
    out[oy * (outWidth * channels + 1)] = 0;
    for (let ox = 0; ox < outWidth; ox += 1) {
      const x0 = Math.floor((ox * width) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outWidth));
      for (let c = 0; c < channels; c += 1) {
        let sum = 0;
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) sum += pixels[y * stride + x * channels + c] as number;
        out[oy * (outWidth * channels + 1) + 1 + ox * channels + c] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(outWidth, 0);
  header.writeUInt32BE(outHeight, 4);
  header.writeUInt8(8, 8);
  header.writeUInt8(colour, 9);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(out, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};
