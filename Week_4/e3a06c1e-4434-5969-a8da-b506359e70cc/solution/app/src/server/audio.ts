// WAV reading and writing, the bundled tone fixture and the procedural formant renderer.
export const SAMPLE_RATE = 16_000;

import type { Voice } from "../shared/types";
import { words } from "../shared/text";

interface Pcm {
  channels: number;
  /** Interleaved signed 16-bit little-endian samples, whole frames only. */
  data: Buffer;
}

export function wavFile(pcm: Buffer, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** The PCM inside a 16 kHz 16-bit mono or stereo RIFF WAV file, or null for anything else. */
export function readWav(file: Buffer): Pcm | null {
  if (file.length < 12 || file.toString("ascii", 0, 4) !== "RIFF" || file.toString("ascii", 8, 12) !== "WAVE") return null;
  let at = 12;
  let format: { channels: number; rate: number; bits: number; tag: number } | null = null;
  while (at + 8 <= file.length) {
    const tag = file.toString("ascii", at, at + 4);
    const size = file.readUInt32LE(at + 4);
    const body = at + 8;
    if (tag === "fmt " && size >= 16 && body + 16 <= file.length) {
      format = {
        tag: file.readUInt16LE(body),
        channels: file.readUInt16LE(body + 2),
        rate: file.readUInt32LE(body + 4),
        bits: file.readUInt16LE(body + 14),
      };
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
      if (format.tag === 0xfffe && size >= 40 && body + 26 <= file.length) format.tag = file.readUInt16LE(body + 24);
    } else if (tag === "data") {
      if (!format || format.tag !== 1 || format.bits !== 16 || format.rate !== SAMPLE_RATE) return null;
      if (format.channels !== 1 && format.channels !== 2) return null;
      const available = Math.min(size, file.length - body);
      const frameBytes = 2 * format.channels;
      return { channels: format.channels, data: file.subarray(body, body + available - (available % frameBytes)) };
    }
    at = body + size + (size & 1);
  }
  return null;
}

export function audioMs(pcmBytes: number, channels: number): number {
  return Math.floor((Math.floor(pcmBytes / (2 * channels)) * 1000) / SAMPLE_RATE);
}

/** 10.000 s of a 1,000 Hz sine at half full scale, 16 kHz mono 16-bit. */
export const TONE_FIXTURE: Buffer = (() => {
  const samples = 10 * SAMPLE_RATE;
  const pcm = Buffer.alloc(samples * 2);
  for (let n = 0; n < samples; n++) pcm.writeInt16LE(Math.round(16384 * Math.sin((2 * Math.PI * 1000 * n) / SAMPLE_RATE)), n * 2);
  return wavFile(pcm, 1);
})();

const WORD_SAMPLES = (300 * SAMPLE_RATE) / 1000;
const VOICE_PITCH: Record<Voice, number> = { lumen: 196, basalt: 104 };
// Vowel formant pairs (F1, F2) in Hz; a word's letters choose its vowel path.
const VOWELS: readonly [number, number][] = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720], [440, 1020]];

function letterSeed(word: string): number {
  let seed = 2166136261;
  for (const char of word.toLowerCase()) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  return seed;
}

/** Renders one formant syllable for a word into `out` at sample offset `at`, 300 ms unless told otherwise. */
function renderWord(out: Float64Array, at: number, word: string, voice: Voice, gain: number, samples = WORD_SAMPLES): void {
  const seed = letterSeed(word);
  const [f1a, f2a] = VOWELS[seed % VOWELS.length];
  const [f1b, f2b] = VOWELS[(seed >>> 8) % VOWELS.length];
  const pitch = VOICE_PITCH[voice] * (1 + ((seed >>> 16) % 13) / 100);
  let phase = 0;
  for (let n = 0; n < samples && at + n < out.length; n++) {
    const t = n / samples;
    const envelope = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2;
    const f0 = pitch * (1.04 - 0.08 * t);
    phase += (2 * Math.PI * f0) / SAMPLE_RATE;
    const f1 = f1a + (f1b - f1a) * t;
    const f2 = f2a + (f2b - f2a) * t;
    let sample = 0;
    // Sum the voice's harmonics, each weighted by its distance to the two formant peaks.
    for (let h = 1; h * f0 < 4000; h++) {
      const f = h * f0;
      const weight = 1 / (1 + ((f - f1) / 90) ** 2) + 0.6 / (1 + ((f - f2) / 140) ** 2);
      sample += weight * Math.sin(h * phase);
    }
    out[at + n] += gain * envelope * sample;
  }
}

function toPcm(signal: Float64Array): Buffer {
  const pcm = Buffer.alloc(signal.length * 2);
  for (let i = 0; i < signal.length; i++) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(signal[i] * 32767))), i * 2);
  return pcm;
}

/** 16 kHz mono 16-bit WAV of procedural formant tones, 300 ms per word. */
export function synthesize(text: string, voice: Voice): { wav: Buffer; durationMs: number } {
  const spoken = words(text);
  const signal = new Float64Array(spoken.length * WORD_SAMPLES);
  spoken.forEach((word, i) => renderWord(signal, i * WORD_SAMPLES, word, voice, 0.22));
  return { wav: wavFile(toPcm(signal), 1), durationMs: spoken.length * 300 };
}

export interface Spoken {
  text: string;
  start_ms: number;
  duration_ms: number;
  voice: Voice;
  gain: number;
}

/** Speech-like audio voicing each word across its slot over a faint room-noise floor (used for seeded recordings). */
export function speechTrack(totalMs: number, words: readonly Spoken[], seed: number): Float64Array {
  const signal = new Float64Array(Math.round((totalMs * SAMPLE_RATE) / 1000));
  let state = seed >>> 0 || 1;
  for (let i = 0; i < signal.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    signal[i] = (state / 4294967296 - 0.5) * 0.004;
  }
  for (const word of words) {
    renderWord(signal, Math.round((word.start_ms * SAMPLE_RATE) / 1000), word.text, word.voice, word.gain, Math.round((word.duration_ms * SAMPLE_RATE) / 1000));
  }
  return signal;
}

export function interleave(channels: readonly Float64Array[]): Buffer {
  const length = channels[0].length;
  const mixed = new Float64Array(length * channels.length);
  for (let i = 0; i < length; i++) for (let c = 0; c < channels.length; c++) mixed[i * channels.length + c] = channels[c][i];
  return toPcm(mixed);
}
