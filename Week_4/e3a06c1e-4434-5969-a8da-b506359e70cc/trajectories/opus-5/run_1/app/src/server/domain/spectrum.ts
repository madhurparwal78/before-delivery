export const FFT_SIZE = 2048;
export const BIN_COUNT = 64;
export const SAMPLE_RATE = 16000;
export const ROWS_PER_SECOND = 30;
export const HISTORY_ROWS = 240;

const hann = new Float64Array(FFT_SIZE);
for (let n = 0; n < FFT_SIZE; n += 1) hann[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / FFT_SIZE));

const reverse = new Uint16Array(FFT_SIZE);
{
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    let value = 0;
    for (let b = 0; b < bits; b += 1) if ((i >> b) & 1) value |= 1 << (bits - 1 - b);
    reverse[i] = value;
  }
}

const cosTable = new Float64Array(FFT_SIZE / 2);
const sinTable = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i += 1) {
  cosTable[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  sinTable[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}

const re = new Float64Array(FFT_SIZE);
const im = new Float64Array(FFT_SIZE);
const magnitude = new Float64Array(FFT_SIZE / 2 + 1);

const fftInPlace = (): void => {
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2;
    const step = FFT_SIZE / size;
    for (let i = 0; i < FFT_SIZE; i += size) {
      for (let j = 0; j < half; j += 1) {
        const c = cosTable[j * step] as number;
        const s = sinTable[j * step] as number;
        const a = i + j;
        const b = a + half;
        const rb = re[b] as number;
        const ib = im[b] as number;
        const tr = rb * c - ib * s;
        const ti = rb * s + ib * c;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
      }
    }
  }
};

/** Band i covers 80 x 100^(i/64) Hz up to, but not including, 80 x 100^((i+1)/64) Hz. */
const bandLowEdge = (i: number): number => 80 * Math.pow(100, i / BIN_COUNT);

interface Band {
  readonly from: number;
  readonly to: number;
}

const bands: Band[] = [];
{
  const df = SAMPLE_RATE / FFT_SIZE;
  const maxBin = FFT_SIZE / 2;
  for (let i = 0; i < BIN_COUNT; i += 1) {
    const lower = bandLowEdge(i);
    const upper = bandLowEdge(i + 1);
    let from = Math.ceil(lower / df);
    let to = Math.ceil(upper / df) - 1;
    if (from > to) {
      const centre = Math.sqrt(lower * upper);
      const nearest = Math.min(maxBin, Math.max(0, Math.round(centre / df)));
      from = nearest;
      to = nearest;
    }
    bands.push({ from: Math.max(0, from), to: Math.min(maxBin, to) });
  }
}

/** A full-scale sine through a Hann window reads 0 dBFS at its bin. */
const FULL_SCALE_MAGNITUDE = FFT_SIZE / 4;

/**
 * One spectrum row: dBFS levels of the most recent FFT_SIZE samples, banded to
 * 64 logarithmic bins and normalised by (dB + 90) / 80.
 */
export const spectrumRow = (window: Float64Array): number[] => {
  for (let n = 0; n < FFT_SIZE; n += 1) {
    const slot = reverse[n] as number;
    re[slot] = (window[n] as number) * (hann[n] as number);
    im[slot] = 0;
  }
  fftInPlace();
  for (let k = 0; k <= FFT_SIZE / 2; k += 1) {
    const r = re[k] as number;
    const i = im[k] as number;
    magnitude[k] = Math.sqrt(r * r + i * i);
  }
  const row: number[] = [];
  for (let i = 0; i < BIN_COUNT; i += 1) {
    const band = bands[i] as Band;
    let peak = 0;
    for (let k = band.from; k <= band.to; k += 1) {
      const value = magnitude[k] as number;
      if (value > peak) peak = value;
    }
    const db = peak > 0 ? 20 * Math.log10(peak / FULL_SCALE_MAGNITUDE) : -Infinity;
    const normalised = (db + 90) / 80;
    const clamped = !Number.isFinite(normalised) || normalised < 0 ? 0 : Math.min(1, normalised);
    row.push(Math.round(clamped * 1000) / 1000);
  }
  return row;
};

export const peakBin = (row: readonly number[]): number => {
  let best = 0;
  let bestValue = row[0] ?? 0;
  for (let i = 1; i < row.length; i += 1) {
    const value = row[i] as number;
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  }
  return best;
};

/** Row r covers audio up to sample floor((r + 1) * SAMPLE_RATE / ROWS_PER_SECOND) per channel. */
export const rowEndSample = (rowIndex: number): number =>
  Math.floor(((rowIndex + 1) * SAMPLE_RATE) / ROWS_PER_SECOND);

export interface LatestRow {
  readonly frame: number;
  readonly peak: number;
  readonly bins: readonly number[];
}

/**
 * Turns a stream of mono samples into spectrum rows, one row per thirtieth of a
 * second, keeping the last HISTORY_ROWS rows and the mean of every row so far.
 */
export class SpectrumStream {
  private readonly ring = new Float64Array(FFT_SIZE);
  private ringPos = 0;
  private samples = 0;
  private rowIndex = 0;
  private readonly history: number[][] = [];
  private readonly sum = new Float64Array(BIN_COUNT);
  private rowCount = 0;
  private latest: LatestRow | null = null;
  private readonly historyLimit: number;

  constructor(historyLimit = HISTORY_ROWS) {
    this.historyLimit = historyLimit;
  }

  push(mono: Float64Array): void {
    for (let i = 0; i < mono.length; i += 1) {
      this.ring[this.ringPos] = mono[i] as number;
      this.ringPos = (this.ringPos + 1) % FFT_SIZE;
      this.samples += 1;
      if (this.samples === rowEndSample(this.rowIndex)) this.computeRow();
    }
  }

  private computeRow(): void {
    const window = new Float64Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i += 1) window[i] = this.ring[(this.ringPos + i) % FFT_SIZE] as number;
    const row = spectrumRow(window);
    this.latest = { frame: this.rowIndex, peak: peakBin(row), bins: row };
    this.rowIndex += 1;
    this.history.push(row);
    if (this.history.length > this.historyLimit) this.history.shift();
    for (let i = 0; i < BIN_COUNT; i += 1) this.sum[i] = (this.sum[i] as number) + (row[i] as number);
    this.rowCount += 1;
  }

  get sampleCount(): number {
    return this.samples;
  }

  get latestRow(): LatestRow | null {
    return this.latest;
  }

  get frame(): number {
    return Math.max(0, this.rowIndex - 1);
  }

  get peak(): number {
    return this.latest?.peak ?? 0;
  }

  get rows(): number[][] {
    return this.history.map((row) => [...row]);
  }

  get sumVector(): number[] {
    return [...this.sum];
  }

  get count(): number {
    return this.rowCount;
  }

  get mean(): number[] {
    return meanOf(this.sumVector, this.rowCount);
  }
}

export const meanOf = (sum: readonly number[], count: number): number[] => {
  const mean: number[] = [];
  for (let i = 0; i < BIN_COUNT; i += 1)
    mean.push(count === 0 ? 0 : Math.round(((sum[i] ?? 0) / count) * 1000) / 1000);
  return mean;
};
