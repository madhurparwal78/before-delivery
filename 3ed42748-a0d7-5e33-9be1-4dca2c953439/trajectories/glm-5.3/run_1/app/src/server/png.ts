import { createInflate } from "node:zlib";
import type { FieldReason } from "./errors.js";

// The PNG chunk walk: every rejection reason is decided here and nowhere else.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const LEGAL_BIT_DEPTH: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16], // greyscale
  2: [8, 16], // truecolour
  3: [1, 2, 4, 8], // indexed
  4: [8, 16], // greyscale with alpha
  6: [8, 16], // truecolour with alpha
};

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const ANIMATION = new Set(["acTL", "fcTL", "fdAT"]);

export async function validatePng(buf: Buffer): Promise<{ reason: null; width?: number; height?: number } | { reason: Extract<FieldReason, "not_png" | "trailing_data" | "animated" | "bad_dimensions" | "bad_image_data">; width?: number; height?: number }> {
  if (buf.length < SIGNATURE.length || !buf.subarray(0, 8).equals(SIGNATURE)) return { reason: "not_png" };

  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  let afterIend = false;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) break;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break;
    const data = buf.subarray(dataStart, dataEnd);
    const crcStored = buf.readUInt32BE(dataEnd);
    if (crcStored !== crc32(buf.subarray(offset + 4, dataEnd))) break;
    if (afterIend) break; // bytes after IEND
    chunks.push({ type, data });
    if (type === "IEND") afterIend = true;
    offset = dataEnd + 4;
  }

  // Every not_png fault over the whole walk, then trailing data, then animation, in that order.
  const notPng = pngStructureFault(chunks);
  if (notPng) return { reason: notPng };
  if (offset < buf.length || !afterIend) return { reason: "trailing_data" };
  if (chunks.some((c) => ANIMATION.has(c.type))) return { reason: "animated" };

  const ihdr = chunks.find((c) => c.type === "IHDR")!.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (width < 320 || width > 2048 || height < 320 || height > 2048) return { reason: "bad_dimensions" };

  const bitDepth = ihdr[8];
  const colourType = ihdr[9];
  const interlace = ihdr[12];
  const channels = CHANNELS[colourType]!;
  const expected = expectedInflatedSize(width, height, channels, bitDepth, interlace);
  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const inflated = await boundedInflate(idat, expected + 1);
  if (!inflated.ok || inflated.out.length !== expected) return { reason: "bad_image_data" };
  const raw = inflated.out;

  const bpp = Math.ceil((width * channels * bitDepth) / 8);
  if (interlace === 0) {
    for (let y = 0; y < height; y++) {
      if (raw[y * (1 + bpp)] > 4) return { reason: "bad_image_data" };
    }
  } else {
    let p = 0;
    for (const [cols, rows] of interlacePasses(width, height)) {
      const rowBytes = Math.ceil((cols * channels * bitDepth) / 8);
      for (let y = 0; y < rows; y++) {
        if (raw[p] > 4) return { reason: "bad_image_data" };
        p += 1 + rowBytes;
      }
    }
  }
  return { reason: null, width, height };
}

/** The `not_png` fault set, judged over the whole chunk walk up to and including the first IEND. */
function pngStructureFault(chunks: Array<{ type: string; data: Buffer }>): "not_png" | null {
  if (chunks.length === 0 || chunks[0].type !== "IHDR") return "not_png";
  const ihdrChunks = chunks.filter((c) => c.type === "IHDR");
  if (ihdrChunks.length !== 1 || chunks[0].data.length !== 13) return "not_png";

  const ihdr = chunks[0].data;
  if (ihdr[10] !== 0 || ihdr[11] !== 0) return "not_png"; // compression / filter method
  if (ihdr[12] !== 0 && ihdr[12] !== 1) return "not_png"; // interlace method
  if (!(LEGAL_BIT_DEPTH[ihdr[9]] ?? []).includes(ihdr[8])) return "not_png";

  for (const c of chunks) {
    if (c.type[0] === c.type[0].toUpperCase() && !CRITICAL.has(c.type)) return "not_png";
  }
  const idatIdx = chunks.map((c, i) => (c.type === "IDAT" ? i : -1)).filter((i) => i >= 0);
  if (idatIdx.length === 0) return "not_png";
  for (let i = 1; i < idatIdx.length; i++) {
    if (idatIdx[i] !== idatIdx[i - 1] + 1) return "not_png"; // IDAT chunks must be consecutive
  }
  if (!chunks.some((c) => c.type === "IEND")) return "not_png";

  const firstIdat = idatIdx[0];
  const plte = chunks.filter((c) => c.type === "PLTE");
  if (ihdr[9] === 3) {
    if (plte.length === 0) return "not_png";
  } else if (ihdr[9] === 0 || ihdr[9] === 4) {
    if (plte.length > 0) return "not_png";
  }
  if (plte.length > 1) return "not_png";
  if (plte.length === 1) {
    const p = plte[0].data;
    if (p.length < 3 || p.length % 3 !== 0 || p.length > 768) return "not_png";
    if (chunks.indexOf(plte[0]) > firstIdat) return "not_png"; // PLTE must precede the first IDAT
  }
  return null;
}

function interlacePasses(width: number, height: number): Array<[number, number]> {
  const specs = [
    [8, 8, 0, 0], [8, 8, 4, 0], [4, 8, 0, 4], [2, 4, 0, 2],
    [1, 2, 1, 0], [1, 2, 0, 1], [1, 1, 0, 0],
  ] as const;
  const out: Array<[number, number]> = [];
  for (const [xStep, yStep, xOffset, yOffset] of specs) {
    const cols = Math.floor((width - xOffset + xStep - 1) / xStep);
    const rows = Math.floor((height - yOffset + yStep - 1) / yStep);
    if (cols > 0 && rows > 0) out.push([cols, rows]);
  }
  return out;
}

function expectedInflatedSize(width: number, height: number, channels: number, bitDepth: number, interlace: number): number {
  if (interlace === 0) {
    return height * (1 + Math.ceil((width * channels * bitDepth) / 8));
  }
  let total = 0;
  for (const [cols, rows] of interlacePasses(width, height)) {
    total += rows * (1 + Math.ceil((cols * channels * bitDepth) / 8));
  }
  return total;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Inflates at most `max` bytes: an oversized stream is cut off one byte past the
 * expected size instead of being expanded fully.
 */
function boundedInflate(data: Buffer, max: number): Promise<{ ok: boolean; out: Buffer }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const inf = createInflate({ chunkSize: 64 * 1024 });
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ ok, out: Buffer.concat(chunks, total) });
    };
    inf.on("data", (c: Buffer) => {
      total += c.length;
      chunks.push(c);
      if (total > max) {
        inf.destroy();
        finish(false);
      }
    });
    inf.on("end", () => finish(true));
    inf.on("error", () => finish(false));
    inf.on("close", () => finish(false));
    inf.end(data);
  });
}
