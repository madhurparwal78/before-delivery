// Real FFT and the spectrum rule. Shared by the server (real computation) and fixture generation.

export class RealFFT {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly rev: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('FFT size must be a power of two');
    this.size = size;
    const m = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < m; b++) r |= ((i >>> b) & 1) << (m - 1 - b);
      this.rev[i] = r;
    }
    this.cosTable = new Float64Array(size / 2);
    this.sinTable = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size);
    }
  }

  /** In-place complex FFT; returns magnitude spectrum of length size/2+1. */
  magnitudes(input: Float64Array): Float64Array {
    const n = this.size;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[this.rev[i]] = input[i];
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const c = this.cosTable[j * step];
          const s = this.sinTable[j * step];
          const a = i + j;
          const b = a + half;
          const tre = re[b] * c - im[b] * s;
          const tim = re[b] * s + im[b] * c;
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
    const out = new Float64Array(n / 2 + 1);
    for (let i = 0; i <= n / 2; i++) out[i] = Math.hypot(re[i], im[i]);
    return out;
  }
}

export const BINS = 64;
export const FFT_SIZE = 2048;
export const SAMPLE_RATE = 16000;
export const FRAME_ROWS_PER_SECOND = 30;
const MIN_DB = -90;
const RANGE_DB = 80;

/** Bin i covers 80×100^(i/64) Hz up to 80×100^((i+1)/64) Hz. */
export function bandFrequencyRange(i: number): { lo: number; hi: number; centre: number } {
  const lo = 80 * Math.pow(100, i / BINS);
  const hi = 80 * Math.pow(100, (i + 1) / BINS);
  return { lo, hi, centre: Math.sqrt(lo * hi) };
}

/** Maps FFT bins onto the 64 bands. Kept internal to createSpectrumComputer. */
function bandBinRanges(): { ranges: { first: number; last: number }[]; singles: number[] } {
  const ranges: { first: number; last: number }[] = [];
  const singles: number[] = [];
  for (let b = 0; b < BINS; b++) {
    const { lo, hi, centre } = bandFrequencyRange(b);
    let first = -1;
    let last = -1;
    for (let k = 0; k <= FFT_SIZE / 2; k++) {
      const f = (k * SAMPLE_RATE) / FFT_SIZE;
      if (f >= lo && f < hi) { if (first === -1) first = k; last = k; }
    }
    if (first !== -1) ranges[b] = { first, last };
    else singles[b] = Math.max(0, Math.min(FFT_SIZE / 2, Math.round((centre * FFT_SIZE) / SAMPLE_RATE)));
  }
  return { ranges, singles };
}

export type SpectrumComputer = {
  /** Process the most recent 2048 samples (zero-padded) and produce the 64-value row. */
  row(samples: Float32Array, sampleCount: number): number[];
};

/** The one place that turns audio samples into a normalised 64-bin spectrum row. */
export function createSpectrumComputer(): SpectrumComputer {
  const fft = new RealFFT(FFT_SIZE);
  const { ranges, singles } = bandBinRanges();
  const hann = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  const window = new Float64Array(FFT_SIZE);

  return {
    row(samples: Float32Array, sampleCount: number): number[] {
      const n = Math.min(sampleCount, FFT_SIZE);
      const offset = sampleCount - n; // take the most recent samples, zero-pad before the start
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = i < n ? samples[offset + i] : 0;
        window[i] = s * hann[i];
      }
      const mag = fft.magnitudes(window);
      const row: number[] = new Array(BINS);
      for (let b = 0; b < BINS; b++) {
        let best = -Infinity;
        if (ranges[b]) {
          for (let k = ranges[b].first; k <= ranges[b].last; k++) best = Math.max(best, mag[k]);
        } else {
          best = mag[singles[b]];
        }
        // dBFS: a full-scale sine reads 0 dB; Hann coherent gain compensated.
        const norm = best / (FFT_SIZE / 4);
        const db = norm > 0 ? 20 * Math.log10(norm) : MIN_DB;
        const v = Math.min(1, Math.max(0, (db - MIN_DB) / RANGE_DB));
        row[b] = Math.round(v * 1000) / 1000;
      }
      return row;
    },
  };
}

/** Peak bin of a completed row: lowest index on a tie. */
export function rowPeakBin(row: number[]): number {
  let best = row[0];
  let idx = 0;
  for (let i = 1; i < row.length; i++) if (row[i] > best) { best = row[i]; idx = i; }
  return idx;
}
