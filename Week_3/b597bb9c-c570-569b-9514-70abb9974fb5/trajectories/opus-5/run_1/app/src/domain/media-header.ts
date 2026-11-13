/**
 * Judging a file by its header. Content alone decides the type, never the extension.
 */
import { UPLOAD_REFUSAL } from './errors.js';
import { mp4DurationToFrames, roundRational, wavSamplesToFrames, type ExactRate } from './rate.js';

export interface Mp4Header {
  kind: 'mp4';
  width: number;
  height: number;
  timescale: number;
  duration: number;
}

export interface WavHeader {
  kind: 'wav';
  sample_rate: number;
  channels: number;
  bits: number;
  samples: number;
  data_offset: number;
  block_align: number;
}

export interface PngHeader {
  kind: 'png';
  width: number;
  height: number;
}

export type MediaHeader = Mp4Header | WavHeader | PngHeader;

export type HeaderJudgement = { ok: true; header: MediaHeader } | { ok: false; reason: string };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function judgeFile(bytes: Buffer): HeaderJudgement {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return judgePng(bytes);
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF') return judgeWav(bytes);
  if (bytes.length >= 8 && bytes.toString('latin1', 4, 8) === 'ftyp') return judgeMp4(bytes);
  return { ok: false, reason: UPLOAD_REFUSAL.unknownType };
}

interface Box {
  type: string;
  contentStart: number;
  contentEnd: number;
}

function readBoxes(bytes: Buffer, start: number, end: number): Box[] | null {
  const boxes: Box[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const declared = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    let contentStart = offset + 8;
    let size: number;
    if (declared === 1) {
      if (offset + 16 > end) return null;
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      contentStart = offset + 16;
    } else if (declared === 0) {
      size = end - offset;
    } else {
      size = declared;
    }
    if (size < 8) return null;
    const boxEnd = offset + size;
    if (boxEnd > end || contentStart > boxEnd) return null;
    boxes.push({ type, contentStart, contentEnd: boxEnd });
    offset = boxEnd;
  }
  return offset === end ? boxes : null;
}

function judgeMp4(bytes: Buffer): HeaderJudgement {
  const damaged: HeaderJudgement = { ok: false, reason: UPLOAD_REFUSAL.mp4Damaged };
  const top = readBoxes(bytes, 0, bytes.length);
  if (!top || top.length === 0 || top[0].type !== 'ftyp') return damaged;
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) return damaged;
  const moovChildren = readBoxes(bytes, moov.contentStart, moov.contentEnd);
  if (!moovChildren) return damaged;
  const mvhd = moovChildren.find((box) => box.type === 'mvhd');
  if (!mvhd) return damaged;
  const movie = readMvhd(bytes, mvhd);
  if (!movie) return damaged;

  for (const trak of moovChildren.filter((box) => box.type === 'trak')) {
    const trakChildren = readBoxes(bytes, trak.contentStart, trak.contentEnd);
    if (!trakChildren) return damaged;
    const tkhd = trakChildren.find((box) => box.type === 'tkhd');
    if (!tkhd) continue;
    const size = readTkhd(bytes, tkhd);
    if (size === null) return damaged;
    if (size.width > 0 && size.height > 0) {
      return {
        ok: true,
        header: { kind: 'mp4', width: size.width, height: size.height, timescale: movie.timescale, duration: movie.duration },
      };
    }
  }
  return damaged;
}

function readMvhd(bytes: Buffer, box: Box): { timescale: number; duration: number } | null {
  if (box.contentStart + 4 > box.contentEnd) return null;
  const version = bytes.readUInt8(box.contentStart);
  let offset = box.contentStart + 4;
  if (version === 0) {
    if (offset + 16 > box.contentEnd) return null;
    offset += 8;
    const timescale = bytes.readUInt32BE(offset);
    const duration = bytes.readUInt32BE(offset + 4);
    return timescale > 0 && duration > 0 ? { timescale, duration } : null;
  }
  if (version === 1) {
    if (offset + 28 > box.contentEnd) return null;
    offset += 16;
    const timescale = bytes.readUInt32BE(offset);
    const duration = bytes.readBigUInt64BE(offset + 4);
    if (duration > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return timescale > 0 && duration > 0n ? { timescale, duration: Number(duration) } : null;
  }
  return null;
}

function readTkhd(bytes: Buffer, box: Box): { width: number; height: number } | null {
  if (box.contentStart + 4 > box.contentEnd) return null;
  const version = bytes.readUInt8(box.contentStart);
  if (version !== 0 && version !== 1) return null;
  const headerBytes = version === 0 ? 24 : 36;
  const widthOffset = box.contentStart + headerBytes + 52;
  if (widthOffset + 8 > box.contentEnd) return null;
  return {
    width: Math.floor(bytes.readUInt32BE(widthOffset) / 65536),
    height: Math.floor(bytes.readUInt32BE(widthOffset + 4) / 65536),
  };
}

function judgeWav(bytes: Buffer): HeaderJudgement {
  const damaged: HeaderJudgement = { ok: false, reason: UPLOAD_REFUSAL.wavDamaged };
  if (bytes.length < 12) return damaged;
  if (bytes.readUInt32LE(4) !== bytes.length - 8) return damaged;
  if (bytes.toString('latin1', 8, 12) !== 'WAVE') return damaged;
  let offset = 12;
  let format: { channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
  let data: { size: number; offset: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    if (contentStart + size > bytes.length) return damaged;
    if (id === 'fmt ') {
      if (size < 16) return damaged;
      format = {
        channels: bytes.readUInt16LE(contentStart + 2),
        sampleRate: bytes.readUInt32LE(contentStart + 4),
        bits: bytes.readUInt16LE(contentStart + 14),
        blockAlign: bytes.readUInt16LE(contentStart + 12),
      };
      if (bytes.readUInt16LE(contentStart) !== 1) return damaged;
    } else if (id === 'data') {
      data = { size, offset: contentStart };
    }
    offset = contentStart + size + (size % 2);
  }
  if (!format || !data) return damaged;
  if (format.channels < 1 || format.channels > 8) return damaged;
  if (format.sampleRate < 8000 || format.sampleRate > 192000) return damaged;
  if (format.bits !== 16 && format.bits !== 24) return damaged;
  const expectedAlign = (format.channels * format.bits) / 8;
  if (format.blockAlign !== expectedAlign) return damaged;
  if (data.size % format.blockAlign !== 0) return damaged;
  return {
    ok: true,
    header: {
      kind: 'wav',
      sample_rate: format.sampleRate,
      channels: format.channels,
      bits: format.bits,
      samples: data.size / format.blockAlign,
      data_offset: data.offset,
      block_align: format.blockAlign,
    },
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function judgePng(bytes: Buffer): HeaderJudgement {
  const damaged: HeaderJudgement = { ok: false, reason: UPLOAD_REFUSAL.pngDamaged };
  if (bytes.length < 8 + 25) return damaged;
  if (bytes.readUInt32BE(8) !== 13) return damaged;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return damaged;
  const stored = bytes.readUInt32BE(29);
  if (crc32(bytes.subarray(12, 29)) !== stored) return damaged;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || width > 16384 || height < 1 || height > 16384) return damaged;
  return { ok: true, header: { kind: 'png', width, height } };
}


/** A PNG has a source of 3,600 seconds' worth of frames. */
export const PNG_SOURCE_SECONDS = 3600;
/** A new PNG clip is 5 seconds long. */
export const PNG_CLIP_SECONDS = 5;

export function sourceFrames(header: MediaHeader, rate: ExactRate): number {
  switch (header.kind) {
    case 'mp4':
      return mp4DurationToFrames(BigInt(header.duration), BigInt(header.timescale), rate);
    case 'wav':
      return wavSamplesToFrames(BigInt(header.samples), BigInt(header.sample_rate), rate);
    case 'png':
      return roundRational(BigInt(PNG_SOURCE_SECONDS) * rate.num, rate.den);
  }
}


/** Waveform peaks: 1,000 buckets over the first channel, four decimals, halves up. */
export function waveformPeaks(bytes: Buffer, header: WavHeader): number[] {
  const total = header.samples;
  const fullScale = header.bits === 16 ? 32768 : 8388608;
  const peaks: number[] = [];
  for (let i = 0; i < 1000; i += 1) {
    const from = Math.floor((i * total) / 1000);
    const to = Math.floor(((i + 1) * total) / 1000);
    let largest = 0;
    for (let sample = from; sample < to; sample += 1) {
      const at = header.data_offset + sample * header.block_align;
      const value =
        header.bits === 16
          ? bytes.readInt16LE(at)
          : (bytes.readUInt8(at) | (bytes.readUInt8(at + 1) << 8) | (bytes.readInt8(at + 2) << 16));
      const magnitude = Math.abs(value);
      if (magnitude > largest) largest = magnitude;
    }
    peaks.push(Math.floor((largest / fullScale) * 10000 + 0.5) / 10000);
  }
  return peaks;
}
