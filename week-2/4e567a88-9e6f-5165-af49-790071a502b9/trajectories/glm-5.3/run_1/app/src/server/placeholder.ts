// Deterministic placeholder media: PNG images, a WAV of the billed seconds, and video bytes.
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A PNG of exactly the given width and height with a deterministic pattern. */
export function placeholderPng(width: number, height: number, seed: string): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  const h = createHash("sha256").update(seed).digest();
  let row = 0;
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 3);
    raw[base] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const o = base + 1 + x * 3;
      // A quiet checkerboard wash varied by the seed hash.
      const band = Math.floor((x + y) / 32) % 3;
      const v = h[(band + row) % h.length];
      raw[o] = 0x24 + (v % 0x10);
      raw[o + 1] = 0x21 + ((v >> 2) % 0x10);
      raw[o + 2] = 0x1c + ((v >> 4) % 0x10);
    }
    row++;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A silent WAV of exactly the given whole seconds. */
export function placeholderWav(seconds: number, seed: string): Buffer {
  const sampleRate = 8000;
  const dataBytes = seconds * sampleRate * 2; // 16-bit mono
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  const h = createHash("sha256").update(seed).digest();
  // A faint deterministic tone, amplitude well under full scale.
  const samples = Buffer.alloc(dataBytes);
  for (let i = 0; i < seconds * sampleRate; i++) {
    const s = Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * (110 + (h[0] % 40))) * 900);
    samples.writeInt16LE(s, i * 2);
  }
  return Buffer.concat([header, samples]);
}

/** Video placeholder bytes; they need not form a playable stream. */
export function placeholderVideo(seed: string): Buffer {
  const header = Buffer.alloc(64);
  header.write("DISPATCH-PLACEHOLDER-VIDEO\n", 0, "ascii");
  const h = createHash("sha256").update(seed).digest();
  h.copy(header, 32);
  return Buffer.concat([header, h, h]);
}
