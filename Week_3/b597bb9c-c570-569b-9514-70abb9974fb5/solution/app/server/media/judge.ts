import { crc32 } from "node:zlib";
import { UPLOAD_REASONS } from "../../shared/copy";
import type { MediaKind } from "../../shared/types";

/** Random access to a file's bytes, wherever they live. */
export interface RangeReader {
  size: number;
  read(offset: number, length: number): Promise<Buffer>;
}

export interface Judged {
  kind: MediaKind;
  width: number | null;
  height: number | null;
  /** Source length as an exact rational of seconds. */
  src_num: bigint;
  src_den: bigint;
  sample_rate: number | null;
  /** WAV only: where the samples start and how many sample frames there are. */
  wav: { data_offset: number; sample_frames: number; block_align: number; bits: number } | null;
}

type Verdict = { ok: true; media: Judged } | { ok: false; reason: string };

const damaged = (reason: string): Verdict => ({ ok: false, reason });
const MOOV_MAX = 32 * 1024 * 1024;

interface Box {
  type: string;
  start: number;
  header: number;
  end: number;
}

/** Walks a chain of boxes that must end exactly at `limit`. */
async function boxes(read: (offset: number, length: number) => Promise<Buffer>, from: number, limit: number): Promise<Box[] | null> {
  const found: Box[] = [];
  let offset = from;
  while (offset < limit) {
    if (limit - offset < 8) return null;
    const head = await read(offset, 16);
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let header = 8;
    if (size === 1) {
      if (limit - offset < 16) return null;
      size = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) {
      size = limit - offset;
    }
    if (size < header || offset + size > limit) return null;
    found.push({ type, start: offset, header, end: offset + size });
    offset += size;
  }
  return found;
}

async function judgeMp4(file: RangeReader): Promise<Verdict> {
  const top = await boxes((o, l) => file.read(o, Math.min(l, file.size - o)), 0, file.size);
  if (!top || top[0]?.type !== "ftyp") return damaged(UPLOAD_REASONS.mp4);
  const moov = top.find((box) => box.type === "moov");
  if (!moov || moov.end - moov.start > MOOV_MAX) return damaged(UPLOAD_REASONS.mp4);
  const payload = await file.read(moov.start + moov.header, moov.end - moov.start - moov.header);
  const inner = await boxes(async (o, l) => payload.subarray(o, o + l), 0, payload.length);
  const mvhd = inner?.find((box) => box.type === "mvhd");
  if (!inner || !mvhd) return damaged(UPLOAD_REASONS.mp4);
  const m = payload.subarray(mvhd.start + mvhd.header, mvhd.end);
  const version = m[0];
  if (version !== 0 && version !== 1) return damaged(UPLOAD_REASONS.mp4);
  if (m.length < (version === 0 ? 20 : 32)) return damaged(UPLOAD_REASONS.mp4);
  const timescale = version === 0 ? m.readUInt32BE(12) : m.readUInt32BE(20);
  const duration = version === 0 ? BigInt(m.readUInt32BE(16)) : m.readBigUInt64BE(24);
  if (timescale === 0 || duration === 0n) return damaged(UPLOAD_REASONS.mp4);
  for (const trak of inner.filter((box) => box.type === "trak")) {
    const children = await boxes(
      async (o, l) => payload.subarray(o, o + l),
      trak.start + trak.header,
      trak.end,
    );
    const tkhd = children?.find((box) => box.type === "tkhd");
    if (!tkhd) continue;
    const t = payload.subarray(tkhd.start + tkhd.header, tkhd.end);
    const at = t[0] === 1 ? 88 : 76;
    if (t.length < at + 8) continue;
    const width = t.readUInt32BE(at) >>> 16;
    const height = t.readUInt32BE(at + 4) >>> 16;
    if (width > 0 && height > 0) {
      return { ok: true, media: { kind: "mp4", width, height, src_num: duration, src_den: BigInt(timescale), sample_rate: null, wav: null } };
    }
  }
  return damaged(UPLOAD_REASONS.mp4);
}

async function judgeWav(file: RangeReader): Promise<Verdict> {
  const head = await file.read(0, Math.min(12, file.size));
  if (head.length < 12 || head.readUInt32LE(4) !== file.size - 8 || head.toString("latin1", 8, 12) !== "WAVE") return damaged(UPLOAD_REASONS.wav);
  let format: { channels: number; rate: number; align: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= file.size) {
    const chunk = await file.read(offset, 8);
    const id = chunk.toString("latin1", 0, 4);
    const size = chunk.readUInt32LE(4);
    if (id === "fmt ") {
      if (size < 16 || offset + 8 + 16 > file.size) return damaged(UPLOAD_REASONS.wav);
      const f = await file.read(offset + 8, 16);
      if (f.readUInt16LE(0) !== 1) return damaged(UPLOAD_REASONS.wav);
      format = { channels: f.readUInt16LE(2), rate: f.readUInt32LE(4), align: f.readUInt16LE(12), bits: f.readUInt16LE(14) };
    } else if (id === "data") {
      if (!format || offset + 8 + size > file.size) return damaged(UPLOAD_REASONS.wav);
      const { channels, rate, align, bits } = format;
      const valid =
        channels >= 1 && channels <= 8 && rate >= 8000 && rate <= 192000 && (bits === 16 || bits === 24) && align === (channels * bits) / 8 && size % align === 0;
      if (!valid) return damaged(UPLOAD_REASONS.wav);
      const frames = size / align;
      return {
        ok: true,
        media: {
          kind: "wav",
          width: null,
          height: null,
          src_num: BigInt(frames),
          src_den: BigInt(rate),
          sample_rate: rate,
          wav: { data_offset: offset + 8, sample_frames: frames, block_align: align, bits },
        },
      };
    }
    offset += 8 + size + (size % 2);
  }
  return damaged(UPLOAD_REASONS.wav);
}

async function judgePng(file: RangeReader): Promise<Verdict> {
  if (file.size < 33) return damaged(UPLOAD_REASONS.png);
  const head = await file.read(8, 25);
  if (head.readUInt32BE(0) !== 13 || head.toString("latin1", 4, 8) !== "IHDR") return damaged(UPLOAD_REASONS.png);
  if (crc32(head.subarray(4, 21)) !== head.readUInt32BE(21)) return damaged(UPLOAD_REASONS.png);
  const width = head.readUInt32BE(8);
  const height = head.readUInt32BE(12);
  if (width < 1 || width > 16384 || height < 1 || height > 16384) return damaged(UPLOAD_REASONS.png);
  return { ok: true, media: { kind: "png", width, height, src_num: 3600n, src_den: 1n, sample_rate: null, wav: null } };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decides the type from the bytes alone, never the extension. */
export async function judgeFile(file: RangeReader): Promise<Verdict> {
  const head = await file.read(0, Math.min(12, file.size));
  if (head.length >= 8 && head.toString("latin1", 4, 8) === "ftyp") return judgeMp4(file);
  if (head.length >= 4 && head.toString("latin1", 0, 4) === "RIFF") return judgeWav(file);
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return judgePng(file);
  return { ok: false, reason: UPLOAD_REASONS.type };
}
