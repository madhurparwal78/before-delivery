// The recognizer stand-in's spectrum: one row per 1/30 s, each a Hann-windowed 2,048-point real FFT
// of the most recent samples (channels averaged), reduced to 64 log-spaced bands from 80 Hz to 8 kHz.
import { SAMPLE_RATE } from "./audio";
import { peakBin } from "../shared/spectrum";

const BINS = 64;
const ROWS_PER_SECOND = 30;
const N = 2048;
const HALF = N / 2;
const FULL_SCALE_MAGNITUDE = N / 4;

const WINDOW = Float64Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
const REVERSED = Uint16Array.from({ length: N }, (_, i) => {
  let r = 0;
  for (let bit = 0, x = i; bit < 11; bit++, x >>= 1) r = (r << 1) | (x & 1);
  return r;
});
const COS = Float64Array.from({ length: HALF }, (_, k) => Math.cos((-2 * Math.PI * k) / N));
const SIN = Float64Array.from({ length: HALF }, (_, k) => Math.sin((-2 * Math.PI * k) / N));

/** FFT bin indices whose frequency lies in band i: [80·100^(i/64), 80·100^((i+1)/64)), or the bin nearest its geometric centre. */
const BANDS: readonly number[][] = Array.from({ length: BINS }, (_, i) => {
  const low = 80 * 100 ** (i / BINS);
  const high = 80 * 100 ** ((i + 1) / BINS);
  const step = SAMPLE_RATE / N;
  const inside: number[] = [];
  for (let k = Math.ceil(low / step); k * step < high && k <= HALF; k++) if (k * step >= low) inside.push(k);
  return inside.length ? inside : [Math.min(HALF, Math.round(Math.sqrt(low * high) / step))];
});

const re = new Float64Array(N);
const im = new Float64Array(N);

/** Normalised band levels (0..1, three decimals) of one 2,048-sample frame. */
function analyse(frame: Float64Array): number[] {
  for (let i = 0; i < N; i++) {
    re[REVERSED[i]] = frame[i] * WINDOW[i];
    im[REVERSED[i]] = 0;
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const stride = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const wr = COS[k * stride];
        const wi = SIN[k * stride];
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  return BANDS.map((band) => {
    let peak = 0;
    for (const k of band) peak = Math.max(peak, Math.hypot(re[k], im[k]));
    const db = 20 * Math.log10(peak / FULL_SCALE_MAGNITUDE);
    const value = Math.min(1, Math.max(0, (db + 90) / 80));
    return Math.round(value * 1000) / 1000;
  });
}

export interface SpectrumRow {
  frame: number;
  bins: number[];
  peak_bin: number;
}

/** Streams interleaved PCM in and emits a row each time the audio passes a 1/30 s boundary. */
export class SpectrumStream {
  private readonly ring = new Float64Array(N);
  private readonly ordered = new Float64Array(N);
  private readonly sums = new Float64Array(BINS);
  private samples = 0;
  rows = 0;

  constructor(private readonly channels: number) {}

  private boundary(): number {
    return Math.floor(((this.rows + 1) * SAMPLE_RATE) / ROWS_PER_SECOND);
  }

  feed(pcm: Buffer): SpectrumRow[] {
    const out: SpectrumRow[] = [];
    const frameBytes = 2 * this.channels;
    for (let at = 0; at + frameBytes <= pcm.length; at += frameBytes) {
      let sum = 0;
      for (let c = 0; c < this.channels; c++) sum += pcm.readInt16LE(at + 2 * c);
      this.ring[this.samples % N] = sum / this.channels / 32768;
      this.samples++;
      if (this.samples === this.boundary()) {
        const oldest = this.samples % N;
        this.ordered.set(this.ring.subarray(oldest), 0);
        this.ordered.set(this.ring.subarray(0, oldest), N - oldest);
        const bins = analyse(this.ordered);
        for (let i = 0; i < BINS; i++) this.sums[i] += bins[i];
        out.push({ frame: this.rows, bins, peak_bin: peakBin(bins) });
        this.rows++;
      }
    }
    return out;
  }

  mean(): number[] {
    return Array.from(this.sums, (sum) => (this.rows ? Math.round((sum / this.rows) * 1000) / 1000 : 0));
  }
}
