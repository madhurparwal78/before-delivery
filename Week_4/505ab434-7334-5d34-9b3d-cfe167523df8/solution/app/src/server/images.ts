// Bytes for the files the seed describes: a PNG or SVG at the stated pixel size, drawn from the asset's colour.
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A palette PNG: a field colour with an ink frame. */
export function drawPng(width: number, height: number, field: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 3, 0, 0, 0], 8);
  const frame = Math.max(1, Math.min(4, Math.floor(Math.min(width, height) / 12)));
  const solid = Buffer.alloc(width + 1, 1);
  const edge = Buffer.alloc(width + 1, 0);
  const middle = Buffer.alloc(width + 1, 1);
  middle.fill(0, 1, 1 + frame);
  middle.fill(0, width + 1 - frame);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) rows.push(y < frame || y >= height - frame ? edge : frame * 2 >= width ? solid : middle);
  const palette = Buffer.from([0x17, 0x16, 0x1c, ...field]);
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function drawSvg(width: number, height: number, field: string): Buffer {
  const size = Math.min(width, height);
  const unit = size / 6;
  const x = (width - unit * 4) / 2;
  const y = (height - unit * 4) / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${field}"/>` +
    `<path d="M${x} ${y + unit}h${unit * 4}l-${unit * 0.5} ${unit}h-${unit * 3}z M${x + unit * 0.25} ${y + unit * 2.25}h${unit * 3.5}l-${unit * 0.5} ${unit}h-${unit * 2.5}z" fill="#17161C"/></svg>`;
  return Buffer.from(svg, "utf8");
}

/** The format of an uploaded file by its content, or null when it is neither PNG nor SVG. */
export function detectFormat(bytes: Buffer): "png" | "svg" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  return /<svg\b/i.test(bytes.subarray(0, 4096).toString("utf8")) ? "svg" : null;
}

/** Pixel size of an uploaded derivative taken from the file itself, or null when it is neither PNG nor SVG. */
export function inspectImage(bytes: Buffer): { format: "png" | "svg"; width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.subarray(12, 16).toString("ascii") === "IHDR") {
    return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const head = bytes.subarray(0, 4096).toString("utf8");
  const root = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!root) return null;
  const size = (name: string): number => Number(new RegExp(`\\s${name}="(\\d+)(?:px)?"`, "i").exec(root)?.[1] ?? 0);
  return { format: "svg", width: size("width"), height: size("height") };
}

export const contentTypeFor = (format: string): string => (format === "svg" ? "image/svg+xml" : "image/png");
