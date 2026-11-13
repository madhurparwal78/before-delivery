/**
 * The small stand-in files written to MinIO at seeding. They carry real MP4,
 * WAV and PNG headers, because Gatecut judges a file by its header alone.
 */
import { deflateSync } from 'node:zlib';
import { crc32 } from '../domain/media-header.js';

function box(type: string, content: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(content.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, content]);
}

/** ftyp (major brand isom) then moov with mvhd and one trak/tkhd, and no mdat. */
export function standInMp4(width: number, height: number, timescale: number, duration: number, tag: string): Buffer {
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom', 'latin1'), Buffer.alloc(4), Buffer.from('isom', 'latin1')]));

  const mvhdContent = Buffer.alloc(100);
  mvhdContent.writeUInt32BE(0, 0);
  mvhdContent.writeUInt32BE(0, 4);
  mvhdContent.writeUInt32BE(0, 8);
  mvhdContent.writeUInt32BE(timescale, 12);
  mvhdContent.writeUInt32BE(duration, 16);
  mvhdContent.writeUInt32BE(0x00010000, 20);
  mvhdContent.writeUInt16BE(0x0100, 24);
  const matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  matrix.forEach((value, index) => mvhdContent.writeUInt32BE(value, 36 + index * 4));
  mvhdContent.writeUInt32BE(2, 96);
  const mvhd = box('mvhd', mvhdContent);

  const tkhdContent = Buffer.alloc(84);
  tkhdContent.writeUInt32BE(0x00000007, 0);
  tkhdContent.writeUInt32BE(0, 4);
  tkhdContent.writeUInt32BE(0, 8);
  tkhdContent.writeUInt32BE(1, 12);
  tkhdContent.writeUInt32BE(0, 16);
  tkhdContent.writeUInt32BE(duration, 20);
  matrix.forEach((value, index) => tkhdContent.writeUInt32BE(value, 40 + index * 4));
  tkhdContent.writeUInt32BE(width * 65536, 76);
  tkhdContent.writeUInt32BE(height * 65536, 80);
  const trak = box('trak', box('tkhd', tkhdContent));

  const free = box('free', Buffer.from(tag, 'utf8'));
  return Buffer.concat([ftyp, free, box('moov', Buffer.concat([mvhd, trak]))]);
}

/** 16-bit mono PCM at 8,000 Hz holding a 110 Hz sine rising from 0 to half full scale. */
export function standInWav(samples: number): Buffer {
  const sampleRate = 8000;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const ramp = samples <= 1 ? 0 : index / (samples - 1);
    const value = Math.sin((2 * Math.PI * 110 * index) / sampleRate) * 16384 * ramp;
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), index * 2);
  }
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * 2, 8);
  fmt.writeUInt16LE(2, 12);
  fmt.writeUInt16LE(16, 14);
  const chunks = Buffer.concat([
    Buffer.from('fmt ', 'latin1'),
    lengthOf(fmt.length),
    fmt,
    Buffer.from('data', 'latin1'),
    lengthOf(data.length),
    data,
  ]);
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), lengthOf(chunks.length + 4), Buffer.from('WAVE', 'latin1'), chunks]);
}

function lengthOf(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function pngChunk(type: string, content: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(content.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), content]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, checksum]);
}

/** A solid image at the given size. */
export function standInPng(width: number, height: number, colour: [number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const start = row * (1 + width * 3);
    raw.writeUInt8(0, start);
    for (let column = 0; column < width; column += 1) {
      raw.writeUInt8(colour[0], start + 1 + column * 3);
      raw.writeUInt8(colour[1], start + 2 + column * 3);
      raw.writeUInt8(colour[2], start + 3 + column * 3);
    }
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
