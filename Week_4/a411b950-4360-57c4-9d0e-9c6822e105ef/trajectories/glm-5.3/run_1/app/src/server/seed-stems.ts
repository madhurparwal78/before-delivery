import { Layer } from "../shared/domain.js";

/**
 * Seed stems synthesized by code (DP-42, IF-06). Mono 16-bit WAV at 22,050 Hz,
 * exactly 8 seconds, looping cleanly, each fading in over its first half
 * second and peaking no louder than a quarter of full scale.
 */

const SAMPLE_RATE = 22050;
const DURATION_SECONDS = 8;
const SAMPLES = SAMPLE_RATE * DURATION_SECONDS;
const FADE_SAMPLES = SAMPLE_RATE / 2;
const PEAK = 0.25;

function fract(value: number): number {
  return value - Math.floor(value);
}

function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff - 0.5;
  };
}

function envelope(index: number): number {
  if (index < FADE_SAMPLES) return index / FADE_SAMPLES;
  return 1;
}

function bedWave(seed: number): Float32Array {
  const random = noise(seed);
  const out = new Float32Array(SAMPLES);
  let previous = 0;
  for (let index = 0; index < SAMPLES; index += 1) {
    const t = index / SAMPLE_RATE;
    const fundamental = 55;
    const low = Math.sin(2 * Math.PI * fundamental * t) * 0.6;
    const octave = Math.sin(2 * Math.PI * fundamental * 2 * t) * 0.25;
    const slow = Math.sin(2 * Math.PI * 0.25 * t) * 0.5 + 0.5;
    const breath = random() * 0.06;
    previous = previous * 0.995 + (low + octave) * 0.005;
    out[index] = (previous * 3 + breath * slow) * envelope(index);
  }
  return out;
}

function pulseWave(seed: number): Float32Array {
  const random = noise(seed);
  const out = new Float32Array(SAMPLES);
  const bpm = 96;
  const beatSeconds = 60 / bpm;
  for (let index = 0; index < SAMPLES; index += 1) {
    const t = index / SAMPLE_RATE;
    const beatPosition = fract(t / beatSeconds);
    const kick = Math.exp(-beatPosition * 18) * Math.sin(2 * Math.PI * 58 * beatPosition * beatSeconds);
    const offbeat = beatPosition > 0.5 ? Math.exp(-(beatPosition - 0.5) * 22) * 0.5 : 0;
    const tick = random() * Math.exp(-beatPosition * 30) * 0.08;
    out[index] = (kick * 0.7 + offbeat * Math.sin(2 * Math.PI * 220 * t) * 0.4 + tick) * envelope(index);
  }
  return out;
}

function leadWave(seed: number): Float32Array {
  const random = noise(seed);
  const out = new Float32Array(SAMPLES);
  const scale = [220, 246.94, 261.63, 293.66, 329.63, 392.0, 440.0];
  const note = Math.floor(seed % 7);
  const base = scale[note];
  for (let index = 0; index < SAMPLES; index += 1) {
    const t = index / SAMPLE_RATE;
    const phrase = fract(t / 4);
    const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 0.006;
    const melodic = Math.sin(2 * Math.PI * (base + vibrato) * t) * 0.6
      + Math.sin(2 * Math.PI * base * 2 * t) * 0.18
      + Math.sin(2 * Math.PI * base * 1.5 * t) * 0.12;
    const swell = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.75 * t);
    const air = random() * 0.015;
    out[index] = (melodic * swell + air) * envelope(index);
  }
  return out;
}

function stingerWave(seed: number): Float32Array {
  const random = noise(seed);
  const out = new Float32Array(SAMPLES);
  const hitsPerSecond = 0.5;
  for (let index = 0; index < SAMPLES; index += 1) {
    const t = index / SAMPLE_RATE;
    const position = fract(t * hitsPerSecond);
    const decay = Math.exp(-position * 6);
    const metallic =
      Math.sin(2 * Math.PI * 1046.5 * position) * 0.4 +
      Math.sin(2 * Math.PI * 1318.5 * position) * 0.3 +
      Math.sin(2 * Math.PI * 1568.0 * position) * 0.2;
    const transient = position < 0.01 ? random() * 0.6 : 0;
    out[index] = (metallic * decay + transient * decay) * envelope(index);
  }
  return out;
}

function normalize(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const value of samples) {
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }
  if (peak === 0) return samples;
  const gain = PEAK / peak;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] *= gain;
  }
  return samples;
}

function loopTail(samples: Float32Array): Float32Array {
  // Cross the final 100 ms into the opening so the loop point is clean.
  const tail = Math.min(Math.floor(SAMPLE_RATE * 0.1), SAMPLES - 1);
  for (let index = 0; index < tail; index += 1) {
    const mix = index / tail;
    const head = samples[index];
    const end = samples[SAMPLES - tail + index];
    samples[SAMPLES - tail + index] = end * (1 - mix) + head * mix;
  }
  return samples;
}

export function synthesizeStem(layer: Layer, seed: number): Buffer {
  let samples: Float32Array;
  switch (layer) {
    case "bed":
      samples = bedWave(seed);
      break;
    case "pulse":
      samples = pulseWave(seed);
      break;
    case "lead":
      samples = leadWave(seed);
      break;
    default:
      samples = stingerWave(seed);
      break;
  }
  samples = loopTail(normalize(samples));
  return encodeWav(samples);
}

export function stemDurationMs(): number {
  return DURATION_SECONDS * 1000;
}

function encodeWav(samples: Float32Array): Buffer {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  }
  return buffer;
}
