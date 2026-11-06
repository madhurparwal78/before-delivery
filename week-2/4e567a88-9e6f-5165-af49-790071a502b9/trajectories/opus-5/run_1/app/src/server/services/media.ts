import { deflateSync } from 'node:zlib';
import { createHash as hash } from 'node:crypto';

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** A deterministic placeholder PNG of exactly the requested pixel size. */
export function placeholderPng(width: number, height: number, seed: string): Buffer {
  const digest = hash('sha256').update(seed).digest();
  const scanlines: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 3;
      row[offset] = (digest[(x + y) % digest.length]! + y) & 0xff;
      row[offset + 1] = (digest[(x * 2 + y) % digest.length]! + x) & 0xff;
      row[offset + 2] = digest[(x + y * 3) % digest.length]!;
    }
    scanlines.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(scanlines), { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const WAV_SAMPLE_RATE = 8000;

/** A placeholder mono WAV of exactly the requested whole seconds. */
export function placeholderWav(seconds: number, seed: string): Buffer {
  const digest = hash('sha256').update(seed).digest();
  const samples = WAV_SAMPLE_RATE * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const value = (digest[index % digest.length]! - 128) * 64;
    data.writeInt16LE(value, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(WAV_SAMPLE_RATE, 24);
  header.writeUInt32LE(WAV_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A deterministic placeholder WebM payload; its bytes need not be a playable stream. */
export function placeholderWebm(width: number, height: number, seconds: number, seed: string): Buffer {
  const digest = hash('sha512').update(`${seed}:${width}x${height}:${seconds}`).digest();
  const blocks: Buffer[] = [Buffer.from([0x1a, 0x45, 0xdf, 0xa3])];
  for (let index = 0; index < seconds * 64; index += 1) {
    blocks.push(hash('sha512').update(digest).update(String(index)).digest());
  }
  return Buffer.concat(blocks);
}

export interface PixelSize {
  width: number;
  height: number;
}

function pngSize(bytes: Buffer): PixelSize | null {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): PixelSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    const length = bytes.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Buffer): PixelSize | null {
  const format = bytes.subarray(12, 16).toString('latin1');
  if (format === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + (bytes.readUIntLE(24, 3) & 0xffffff),
      height: 1 + (bytes.readUIntLE(27, 3) & 0xffffff),
    };
  }
  if (format === 'VP8 ' && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

export function pixelSizeOf(mediaType: string, bytes: Buffer): PixelSize | null {
  if (mediaType === 'image/png') return pngSize(bytes);
  if (mediaType === 'image/jpeg') return jpegSize(bytes);
  if (mediaType === 'image/webp') return webpSize(bytes);
  return null;
}

export function extensionFor(mediaType: string): 'png' | 'jpg' | 'webp' | 'webm' | 'wav' {
  switch (mediaType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'video/webm':
      return 'webm';
    case 'audio/wav':
      return 'wav';
    default:
      throw new Error(`No extension for media type ${mediaType}`);
  }
}
