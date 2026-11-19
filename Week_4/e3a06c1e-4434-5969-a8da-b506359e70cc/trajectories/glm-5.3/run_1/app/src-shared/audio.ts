// WAV reading/writing for 16 kHz 16-bit PCM, plus the deterministic seed-audio and synthesis renderers.

import { SAMPLE_RATE } from './spectrum';

export type WavInfo = {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: Uint8Array;
  samples: Float32Array; // interleaved, normalised to [-1, 1]
};

export function parseWav(buf: Uint8Array): WavInfo | null {
  if (buf.length < 44) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let off = 12;
  let fmt: { channels: number; rate: number; bits: number } | null = null;
  let data: Uint8Array | null = null;
  while (off + 8 <= buf.length) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buf.length) return null;
      const audioFormat = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const rate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      if (audioFormat !== 1) return null;
      fmt = { channels, rate, bits };
    } else if (id === 'data') {
      const end = Math.min(body + size, buf.length);
      data = buf.subarray(body, end);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) return null;
  if (fmt.bits !== 16 || fmt.rate !== SAMPLE_RATE || (fmt.channels !== 1 && fmt.channels !== 2)) return null;
  const count = Math.floor(data.length / (2 * fmt.channels));
  const samples = new Float32Array(count * fmt.channels);
  const dvData = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < samples.length; i++) samples[i] = dvData.getInt16(i * 2, true) / 32768;
  return { channels: fmt.channels, sampleRate: fmt.rate, bitsPerSample: fmt.bits, dataBytes: data, samples };
}

/** Canonical 44-byte WAV header followed by 16-bit LE samples. */
export function writeWav(samples: Int16Array, channels: number, sampleRate = SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * 2, true);
  dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true);
  return out;
}

/** 10.000 s of a 1 kHz sine at half full scale, mono 16-bit 16 kHz. Deterministic. */
export function toneFixture(): Uint8Array {
  const n = 10 * SAMPLE_RATE;
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.round(Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE) * 16384);
  return writeWav(s, 1);
}

/**
 * Deterministic multi-voice audio used for seed sessions: a sum of sine partials
 * with a seeded PRNG, so every run of the app produces the same bytes.
 */
export function seedAudio(seconds: number, channels: number, seed: number): Uint8Array {
  let state = (seed >>> 0) || 1;
  const rnd = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0x100000000;
  };
  const n = Math.round(seconds * SAMPLE_RATE);
  const freqs: number[] = [];
  const amps: number[] = [];
  const voices = 5;
  for (let v = 0; v < voices; v++) {
    freqs.push(120 + Math.floor(rnd() * 3800));
    amps.push(0.08 + rnd() * 0.1);
  }
  const phases = freqs.map(() => rnd() * 2 * Math.PI);
  const out = new Int16Array(n * channels);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let f = 0; f < voices; f++) v += amps[f] * Math.sin(2 * Math.PI * freqs[f] * (i / SAMPLE_RATE) + phases[f]);
    const s = Math.max(-1, Math.min(1, v * 0.9 * (0.7 + 0.3 * Math.sin((2 * Math.PI * 2 * i) / SAMPLE_RATE))));
    const q = Math.round(s * 32767);
    for (let c = 0; c < channels; c++) out[i * channels + c] = q;
  }
  return writeWav(out, channels);
}

/**
 * Procedural formant-tone synthesis. Same text and voice always render identical bytes:
 * duration_ms = word count × 300; each word becomes a three-formant tone sweep.
 */
export function renderSynthesis(text: string, voice: 'lumen' | 'basalt'): Uint8Array {
  const words = splitUnicodeWords(text);
  const durationMs = words.length * 300;
  const samples = new Int16Array(Math.round((durationMs / 1000) * SAMPLE_RATE));
  const base = voice === 'lumen' ? [650, 1220, 2600] : [440, 1020, 2250];
  let state = 0;
  for (let w = 0; w < words.length; w++) {
    let h = 0;
    for (let i = 0; i < words[w].length; i++) h = (h * 31 + words[w].charCodeAt(i)) >>> 0;
    state = (state * 31 + h + w) >>> 0;
    const jitter = ((state % 997) / 997 - 0.5) * 0.5;
    const start = Math.floor((w * 300 / 1000) * SAMPLE_RATE);
    const len = Math.floor((300 / 1000) * SAMPLE_RATE);
    for (let i = 0; i < len && start + i < samples.length; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.sin((Math.PI * i) / len) ** 2;
      const f0 = base[0] * (1 + jitter * 0.1) * (1 + 0.08 * Math.sin(2 * Math.PI * 5.5 * t));
      let v = 0;
      for (let f = 0; f < 3; f++) v += (0.5 / (f + 1)) * Math.sin(2 * Math.PI * base[f] * (1 + jitter * (f + 1) * 0.05) * t + f);
      v += 0.15 * Math.sin(2 * Math.PI * f0 * t);
      samples[start + i] = Math.max(-32767, Math.min(32767, Math.round(v * env * 12000)));
    }
  }
  return writeWav(samples, 1);
}

function splitUnicodeWords(s: string): string[] {
  const words: string[] = [];
  let cur = '';
  const ws = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;
  for (const ch of s) {
    if (ws.test(ch)) { if (cur) { words.push(cur); cur = ''; } } else cur += ch;
  }
  if (cur) words.push(cur);
  return words;
}
