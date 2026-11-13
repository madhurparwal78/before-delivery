import { judgeFile } from "./judge";

const BUCKETS = 1000;
const BLOCK_BYTES = 4 * 1024 * 1024;

type Reader = (range: { start: number; end: number }) => Promise<Buffer | null>;

/** Largest absolute first-channel sample per bucket over full scale, four decimals, halves up. */
export async function computePeaks(size: number, get: Reader): Promise<number[]> {
  const verdict = await judgeFile({
    size,
    read: async (offset, length) => (await get({ start: offset, end: Math.min(size, offset + length) - 1 })) ?? Buffer.alloc(0),
  });
  const wav = verdict.ok ? verdict.media.wav : null;
  if (!wav) throw new Error("stored file is not a readable WAV");
  const full = wav.bits === 16 ? 32768 : 8388608;
  const width = wav.bits / 8;
  const frames = wav.sample_frames;
  const peaks = new Array<number>(BUCKETS).fill(0);
  const bounds = Array.from({ length: BUCKETS + 1 }, (_, i) => Math.floor((i * frames) / BUCKETS));
  const maxima = new Array<number>(BUCKETS).fill(0);
  const perBlock = Math.max(1, Math.floor(BLOCK_BYTES / wav.block_align));
  let bucket = 0;
  for (let first = 0; first < frames; first += perBlock) {
    const count = Math.min(perBlock, frames - first);
    const start = wav.data_offset + first * wav.block_align;
    const block = await get({ start, end: start + count * wav.block_align - 1 });
    if (!block) throw new Error("stored file is shorter than its header");
    for (let i = 0; i < count; i += 1) {
      const frame = first + i;
      while ((bounds[bucket + 1] ?? frames) <= frame) bucket += 1;
      const at = i * wav.block_align;
      const sample = width === 2 ? block.readInt16LE(at) : block.readIntLE(at, 3);
      const magnitude = Math.abs(sample);
      if (magnitude > (maxima[bucket] ?? 0)) maxima[bucket] = magnitude;
    }
  }
  for (let i = 0; i < BUCKETS; i += 1) peaks[i] = Math.floor(((maxima[i] ?? 0) * 20000 + full) / (2 * full)) / 10000;
  return peaks;
}
