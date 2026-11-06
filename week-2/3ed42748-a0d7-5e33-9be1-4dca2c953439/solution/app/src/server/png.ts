// The postcard image check: walks every chunk up to the first IEND, then inflates the image
// data and compares it with the size the header promises. The first failed check decides.
import { inflateSync } from "node:zlib";

type PngReason = "not_png" | "trailing_data" | "animated" | "bad_dimensions" | "bad_image_data";
type PngCheck = { ok: true; width: number; height: number } | { ok: false; reason: PngReason };

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIN_SIDE = 320;
const MAX_SIDE = 2048;

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(data: Buffer): number {
  let c = -1;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Legal bit depths per colour type, with the channel count of each type. */
const COLOUR_TYPES: Record<number, { depths: number[]; channels: number }> = {
  0: { depths: [1, 2, 4, 8, 16], channels: 1 },
  2: { depths: [8, 16], channels: 3 },
  3: { depths: [1, 2, 4, 8], channels: 1 },
  4: { depths: [8, 16], channels: 2 },
  6: { depths: [8, 16], channels: 4 },
};

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** Rows of each pass as [rows, bytes per row including the filter byte]. */
function scanlines(width: number, height: number, bitsPerPixel: number, interlaced: boolean): Array<[number, number]> {
  const rowBytes = (w: number): number => 1 + Math.ceil((w * bitsPerPixel) / 8);
  if (!interlaced) return [[height, rowBytes(width)]];
  const passes: Array<[number, number]> = [];
  for (const [x0, y0, dx, dy] of ADAM7) {
    const w = Math.ceil((width - x0) / dx);
    const h = Math.ceil((height - y0) / dy);
    if (w > 0 && h > 0) passes.push([h, rowBytes(w)]);
  }
  return passes;
}

export function checkPng(body: Buffer): PngCheck {
  const fail = (reason: PngReason): PngCheck => ({ ok: false, reason });
  if (body.length < 8 || !body.subarray(0, 8).equals(SIGNATURE)) return fail("not_png");
  let pos = 8;
  let header: Buffer | null = null;
  let palette = 0;
  let idat: Buffer[] = [];
  let idatClosed = false;
  let animated = false;
  let ended = false;
  while (pos < body.length) {
    if (pos + 12 > body.length) return fail("not_png");
    const length = body.readUInt32BE(pos);
    const type = body.subarray(pos + 4, pos + 8);
    if (pos + 12 + length > body.length) return fail("not_png");
    const name = type.toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(name)) return fail("not_png");
    const data = body.subarray(pos + 8, pos + 8 + length);
    if (crc32(body.subarray(pos + 4, pos + 8 + length)) !== body.readUInt32BE(pos + 8 + length)) return fail("not_png");
    if (!header && (name !== "IHDR" || length !== 13)) return fail("not_png");
    if (header && name === "IHDR") return fail("not_png");
    const critical = name.charCodeAt(0) < 97;
    if (critical && !["IHDR", "PLTE", "IDAT", "IEND"].includes(name)) return fail("not_png");
    if (name !== "IDAT" && idat.length) idatClosed = true;
    if (name === "IHDR") header = data;
    else if (name === "PLTE") {
      if (palette || idat.length || length < 3 || length > 768 || length % 3) return fail("not_png");
      palette = length;
    } else if (name === "IDAT") {
      if (idatClosed) return fail("not_png");
      idat.push(data);
    } else if (name === "acTL" || name === "fcTL" || name === "fdAT") animated = true;
    pos += 12 + length;
    if (name === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || !header || !idat.length) return fail("not_png");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [depth, colour, compression, filter, interlace] = [header[8]!, header[9]!, header[10]!, header[11]!, header[12]!];
  const kind = COLOUR_TYPES[colour];
  if (!kind || !kind.depths.includes(depth)) return fail("not_png");
  if (compression !== 0 || filter !== 0 || interlace > 1) return fail("not_png");
  if (colour === 3 && !palette) return fail("not_png");
  if ((colour === 0 || colour === 4) && palette) return fail("not_png");
  if (pos !== body.length) return fail("trailing_data");
  if (animated) return fail("animated");
  if (width < MIN_SIDE || width > MAX_SIDE || height < MIN_SIDE || height > MAX_SIDE) return fail("bad_dimensions");
  const passes = scanlines(width, height, depth * kind.channels, interlace === 1);
  const expected = passes.reduce((sum, [rows, bytes]) => sum + rows * bytes, 0);
  const joined = Buffer.concat(idat);
  idat = [];
  let raw: Buffer;
  try {
    const result = inflateSync(joined, { info: true, maxOutputLength: expected + 1 }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    if (result.engine.bytesWritten !== joined.length) return fail("bad_image_data");
    raw = result.buffer;
  } catch {
    return fail("bad_image_data");
  }
  if (raw.length !== expected) return fail("bad_image_data");
  let at = 0;
  for (const [rows, bytes] of passes) {
    for (let r = 0; r < rows; r++, at += bytes) if (raw[at]! > 4) return fail("bad_image_data");
  }
  return { ok: true, width, height };
}
