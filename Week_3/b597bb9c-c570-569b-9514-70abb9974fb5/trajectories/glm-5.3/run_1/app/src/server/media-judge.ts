/**
 * Files are judged by their header alone, never by extension.
 * Pure byte parsing: MP4 box structure, WAV RIFF chunks, PNG chunks.
 */

export interface Mp4Info {
  width: number;
  height: number;
  timescale: number;
  duration: number;
}

export interface WavInfo {
  channels: number;
  sampleRate: number;
  bits: number;
  sampleFrames: number;
  blockAlign: number;
}

export interface PngInfo {
  width: number;
  height: number;
}

export type MediaKind = 'mp4' | 'wav' | 'png';

export interface JudgedMedia {
  kind: MediaKind;
  bytes: number;
  sha256: string;
  mp4?: Mp4Info;
  wav?: WavInfo;
  png?: PngInfo;
}

export type RefusalReason =
  | 'unknown file type'
  | 'MP4 header is damaged'
  | 'WAV header is damaged'
  | 'PNG header is damaged';

export type JudgeResult = { ok: true; media: JudgedMedia } | { ok: false; reason: RefusalReason };

/** Judge a buffer by its header. Returns the kind and header facts, or a refusal. */
export function judgeMedia(bytes: Uint8Array, sha256: string): JudgeResult {
  if (isMp4(bytes)) {
    const info = readMp4(bytes);
    if (info === null) return { ok: false, reason: 'MP4 header is damaged' };
    return { ok: true, media: { kind: 'mp4', bytes: bytes.length, sha256, mp4: info } };
  }
  if (isWav(bytes)) {
    const info = readWav(bytes);
    if (info === null) return { ok: false, reason: 'WAV header is damaged' };
    return { ok: true, media: { kind: 'wav', bytes: bytes.length, sha256, wav: info } };
  }
  if (isPng(bytes)) {
    const info = readPng(bytes);
    if (info === null) return { ok: false, reason: 'PNG header is damaged' };
    return { ok: true, media: { kind: 'png', bytes: bytes.length, sha256, png: info } };
  }
  return { ok: false, reason: 'unknown file type' };
}

// ---- MP4 ----

function ascii(bytes: Uint8Array, off: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[off + i] ?? 0);
  return s;
}

function u32(bytes: Uint8Array, off: number): number {
  return (
    ((bytes[off] ?? 0) * 0x1000000) +
    ((bytes[off + 1] ?? 0) << 16) +
    ((bytes[off + 2] ?? 0) << 8) +
    (bytes[off + 3] ?? 0)
  ) >>> 0;
}

function u64(bytes: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[off + i] ?? 0);
  return v;
}

function u16(bytes: Uint8Array, off: number): number {
  return ((bytes[off] ?? 0) << 8) | (bytes[off + 1] ?? 0);
}

/** WAV RIFF fields are little-endian; MP4 boxes are big-endian. */
function u32le(bytes: Uint8Array, off: number): number {
  return (
    (bytes[off] ?? 0) +
    ((bytes[off + 1] ?? 0) << 8) +
    ((bytes[off + 2] ?? 0) << 16) +
    (bytes[off + 3] ?? 0) * 0x1000000
  ) >>> 0;
}

function u16le(bytes: Uint8Array, off: number): number {
  return ((bytes[off] ?? 0) + ((bytes[off + 1] ?? 0) << 8)) & 0xffff;
}

function startsWith(bytes: Uint8Array, sig: number[], off = 0): boolean {
  for (let i = 0; i < sig.length; i++) {
    if (bytes[off + i] !== sig[i]) return false;
  }
  return true;
}

const MP4_FTYP = [0x66, 0x74, 0x79, 0x70]; // 'ftyp'

function isMp4(b: Uint8Array): boolean {
  return b.length >= 8 && ascii(b, 4, 4) === 'ftyp';
}

interface Box {
  type: string;
  start: number;
  size: number; // total box size including header
}

/** Walk top-level boxes; chain must reach exactly the end of the file. */
function topLevelBoxes(b: Uint8Array): Box[] | null {
  const boxes: Box[] = [];
  let pos = 0;
  while (pos < b.length) {
    if (pos + 8 > b.length) return null;
    let size = u32(b, pos);
    const type = ascii(b, pos + 4, 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > b.length) return null;
      const big = u64(b, pos + 8);
      if (big > BigInt(b.length - pos)) return null;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = b.length - pos;
    } else if (size < 8) {
      return null;
    }
    if (size < header || pos + size > b.length) return null;
    boxes.push({ type, start: pos, size });
    pos += size;
  }
  return boxes;
}

function childBoxes(b: Uint8Array, start: number, headerLen: number, size: number): Box[] | null {
  const boxes: Box[] = [];
  const end = start + size;
  let pos = start + headerLen;
  while (pos < end) {
    if (pos + 8 > end) return null;
    let sz = u32(b, pos);
    const type = ascii(b, pos + 4, 4);
    let header = 8;
    if (sz === 1) {
      if (pos + 16 > end) return null;
      const big = u64(b, pos + 8);
      if (big > BigInt(end - pos)) return null;
      sz = Number(big);
      header = 16;
    } else if (sz === 0) {
      sz = end - pos;
    } else if (sz < 8) {
      return null;
    }
    if (sz < header || pos + sz > end) return null;
    boxes.push({ type, start: pos, size: sz });
    pos += sz;
  }
  return boxes;
}

function readMp4(b: Uint8Array): Mp4Info | null {
  const tops = topLevelBoxes(b);
  if (tops === null || tops.length === 0) return null;
  if (tops[0]!.type !== 'ftyp') return null;
  const moov = tops.find((box) => box.type === 'moov');
  if (moov === undefined) return null;
  const moovChildren = childBoxes(b, moov.start, 8, moov.size);
  if (moovChildren === null) return null;
  const mvhd = moovChildren.find((box) => box.type === 'mvhd');
  if (mvhd === undefined) return null;
  let timescale = 0;
  let duration = 0;
  const version = b[mvhd.start + 8] ?? 0;
  if (version === 0) {
    // fullbox(4) + creation(4) + modification(4)
    timescale = u32(b, mvhd.start + 12 + 8);
    duration = u32(b, mvhd.start + 16 + 8);
  } else if (version === 1) {
    // fullbox(4) + creation(8) + modification(8)
    timescale = u32(b, mvhd.start + 20 + 8);
    const hi = BigInt(u32(b, mvhd.start + 24 + 8));
    const lo = BigInt(u32(b, mvhd.start + 28 + 8));
    duration = Number((hi << 32n) | lo);
  } else {
    return null;
  }
  if (timescale <= 0 || duration <= 0) return null;
  let dims: { width: number; height: number } | null = null;
  for (const trak of moovChildren.filter((box) => box.type === 'trak')) {
    const trakChildren = childBoxes(b, trak.start, 8, trak.size);
    if (trakChildren === null) continue;
    const tkhd = trakChildren.find((box) => box.type === 'tkhd');
    if (tkhd === undefined) continue;
    const tkVersion = b[tkhd.start + 8] ?? 0;
    let off: number;
    if (tkVersion === 0) {
      // header(8) version+flags(4) ctime(4) mtime(4) trackid(4) reserved(4)
      // duration(4) reserved(8) layer(2) altgroup(2) volume(2) reserved(2) matrix(36)
      off = tkhd.start + 8 + 4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36;
    } else {
      off = tkhd.start + 8 + 4 + 8 + 8 + 4 + 4 + 8 + 2 + 2 + 2 + 2 + 36;
    }
    if (off + 8 > tkhd.start + tkhd.size) continue;
    const wFixed = u32(b, off);
    const hFixed = u32(b, off + 4);
    const w = wFixed >>> 16; // 16.16 fixed point, integer part
    const h = hFixed >>> 16;
    if (w > 0 && h > 0) {
      dims = { width: w, height: h };
      break;
    }
  }
  if (dims === null) return null;
  return { width: dims.width, height: dims.height, timescale, duration };
}

// ---- WAV ----

const RIFF = [0x52, 0x49, 0x46, 0x46]; // 'RIFF'
const WAVE_FORM = [0x57, 0x41, 0x56, 0x45]; // 'WAVE'

function isWav(b: Uint8Array): boolean {
  return b.length >= 12 && startsWith(b, RIFF);
}

function readWav(b: Uint8Array): WavInfo | null {
  if (b.length < 12) return null;
  if (!startsWith(b, RIFF)) return null;
  const riffSize = u32le(b, 4);
  if (riffSize !== b.length - 8) return null;
  if (!startsWith(b, WAVE_FORM, 8)) return null;
  let fmt: { channels: number; sampleRate: number; bits: number; blockAlign: number } | null = null;
  let data: { size: number; start: number } | null = null;
  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = ascii(b, pos, 4);
    const size = u32le(b, pos + 4);
    const body = pos + 8;
    if (body + size > b.length) return null;
    if (id === 'fmt ') {
      if (size < 16) return null;
      const format = u16le(b, body);
      const channels = u16le(b, body + 2);
      const sampleRate = u32le(b, body + 4);
      const blockAlign = u16le(b, body + 12);
      const bits = u16le(b, body + 14);
      if (format !== 1) return null;
      if (channels < 1 || channels > 8) return null;
      if (sampleRate < 8000 || sampleRate > 192000) return null;
      if (bits !== 16 && bits !== 24) return null;
      if (blockAlign !== (channels * bits) / 8) return null;
      fmt = { channels, sampleRate, bits, blockAlign };
    } else if (id === 'data') {
      data = { size, start: body };
    }
    pos = body + size + (size % 2);
  }
  if (fmt === null || data === null) return null;
  if (data.size % fmt.blockAlign !== 0) return null;
  if (data.start + data.size > b.length) return null;
  const sampleFrames = data.size / fmt.blockAlign;
  return { channels: fmt.channels, sampleRate: fmt.sampleRate, bits: fmt.bits, sampleFrames, blockAlign: fmt.blockAlign };
}

// ---- PNG ----

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && startsWith(b, PNG_SIG);
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = ~0;
  for (let i = start; i < end; i++) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function readPng(b: Uint8Array): PngInfo | null {
  if (b.length < 8 + 25) return null;
  if (!startsWith(b, PNG_SIG)) return null;
  const ihdrStart = 8;
  const length = u32(b, ihdrStart);
  if (length !== 13) return null;
  const type = ascii(b, ihdrStart + 4, 4);
  if (type !== 'IHDR') return null;
  const dataStart = ihdrStart + 8;
  if (dataStart + 13 + 4 > b.length) return null;
  const crcStored = u32(b, dataStart + 13);
  const crcActual = crc32(b, ihdrStart + 4, dataStart + 13);
  if (crcStored !== crcActual) return null;
  const width = u32(b, dataStart);
  const height = u32(b, dataStart + 4);
  if (width < 1 || width > 16384 || height < 1 || height > 16384) return null;
  return { width, height };
}

/** Waveform peaks of the first channel: 1,000 buckets over N sample frames. */
export function waveformPeaks(bytes: Uint8Array, info: WavInfo): number[] {
  const peaks = new Array<number>(1000).fill(0);
  const { bits, blockAlign, sampleFrames } = info;
  // Find the data chunk again (readWav already validated the layout).
  let pos = 12;
  let data: { start: number; size: number } | null = null;
  while (pos + 8 <= bytes.length) {
    const id = ascii(bytes, pos, 4);
    const size = u32(bytes, pos + 4);
    if (id === 'data') data = { start: pos + 8, size };
    pos = pos + 8 + size + (size % 2);
  }
  if (data === null) return peaks;
  const fullScale = bits === 16 ? 32768 : 8388608;
  const bytesPerSample = bits / 8;
  for (let i = 0; i < 1000; i++) {
    const from = Math.floor((i * sampleFrames) / 1000);
    const to = Math.floor(((i + 1) * sampleFrames) / 1000);
    if (to <= from) continue;
    let max = 0;
    for (let s = from; s < to; s++) {
      const sampleOff = data.start + s * blockAlign;
      let v: number;
      if (bits === 16) {
        if (sampleOff + 2 > bytes.length) break;
        const raw = (bytes[sampleOff]! | (bytes[sampleOff + 1]! << 8)) << 16 >> 16;
        v = Math.abs(raw);
      } else {
        if (sampleOff + 3 > bytes.length) break;
        const raw = (bytes[sampleOff]! | (bytes[sampleOff + 1]! << 8) | (bytes[sampleOff + 2]! << 16)) << 8 >> 8;
        v = Math.abs(raw);
      }
      if (v > max) max = v;
    }
    // rounded to four decimals with halves rounding up
    const scaled = (max * 10000) / fullScale;
    peaks[i] = Math.ceil(scaled - 1e-9) / 10000;
  }
  return peaks;
}
