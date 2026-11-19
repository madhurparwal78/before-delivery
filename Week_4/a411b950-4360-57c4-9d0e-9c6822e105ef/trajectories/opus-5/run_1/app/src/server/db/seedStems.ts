import { encodeWav } from '../domain/audio.ts';
import type { Layer } from '../../shared/projectStatus.ts';

const SAMPLE_RATE = 22_050;
const DURATION_SECONDS = 8;
const SAMPLE_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const PEAK = 0.25;
const FADE_SECONDS = 0.5;

/** A small deterministic generator so each project's stems differ but never change between starts. */
function seededRandom(seed: string): () => number {
  let state = 0x811c9dc5;
  for (const character of seed) {
    state ^= character.codePointAt(0) as number;
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Only frequencies that complete whole cycles inside the loop keep it seamless. */
function loopFrequency(hertz: number): number {
  const step = 1 / DURATION_SECONDS;
  return Math.max(step, Math.round(hertz / step) * step);
}

function normalise(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const scale = peak === 0 ? 0 : PEAK / peak;
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = (samples[index] as number) * scale;
  }
  const fadeSamples = Math.round(FADE_SECONDS * SAMPLE_RATE);
  for (let index = 0; index < fadeSamples; index += 1) {
    samples[index] = (samples[index] as number) * (index / fadeSamples);
  }
  return samples;
}

function bedStem(random: () => number): Float32Array {
  const samples = new Float32Array(SAMPLE_COUNT);
  const root = loopFrequency(41 + random() * 18);
  const partials = [1, 2, 3, 5].map((multiple) => ({
    frequency: loopFrequency(root * multiple),
    gain: 1 / (multiple * 1.6),
    phase: random() * Math.PI * 2,
  }));
  const swell = loopFrequency(1 / 4);
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const time = index / SAMPLE_RATE;
    let value = 0;
    for (const partial of partials) {
      value += Math.sin(2 * Math.PI * partial.frequency * time + partial.phase) * partial.gain;
    }
    samples[index] = value * (0.75 + 0.25 * Math.sin(2 * Math.PI * swell * time));
  }
  return normalise(samples);
}

function pulseStem(random: () => number): Float32Array {
  const samples = new Float32Array(SAMPLE_COUNT);
  const hitsPerLoop = 16;
  const tone = loopFrequency(110 + random() * 60);
  const decay = 7 + random() * 6;
  for (let hit = 0; hit < hitsPerLoop; hit += 1) {
    const start = Math.round((hit / hitsPerLoop) * SAMPLE_COUNT);
    const accent = hit % 4 === 0 ? 1 : 0.55;
    for (let index = 0; index < SAMPLE_RATE / 2; index += 1) {
      const target = start + index;
      if (target >= SAMPLE_COUNT) break;
      const time = index / SAMPLE_RATE;
      const envelope = Math.exp(-decay * time);
      const body = Math.sin(2 * Math.PI * tone * time) * 0.7 + Math.sin(2 * Math.PI * tone * 2.01 * time) * 0.3;
      samples[target] = (samples[target] as number) + body * envelope * accent;
    }
  }
  return normalise(samples);
}

function leadStem(random: () => number): Float32Array {
  const samples = new Float32Array(SAMPLE_COUNT);
  const scale = [0, 3, 5, 7, 10, 12];
  const base = 220 + random() * 60;
  const noteCount = 8;
  for (let note = 0; note < noteCount; note += 1) {
    const step = scale[Math.floor(random() * scale.length)] as number;
    const frequency = loopFrequency(base * Math.pow(2, step / 12));
    const start = Math.round((note / noteCount) * SAMPLE_COUNT);
    const length = Math.round(SAMPLE_COUNT / noteCount);
    for (let index = 0; index < length; index += 1) {
      const target = start + index;
      if (target >= SAMPLE_COUNT) break;
      const time = index / SAMPLE_RATE;
      const progress = index / length;
      const envelope = Math.sin(Math.PI * progress) ** 1.4;
      samples[target] =
        (samples[target] as number) +
        (Math.sin(2 * Math.PI * frequency * time) + Math.sin(2 * Math.PI * frequency * 2 * time) * 0.25) * envelope;
    }
  }
  return normalise(samples);
}

function stingerStem(random: () => number): Float32Array {
  const samples = new Float32Array(SAMPLE_COUNT);
  const hitLength = Math.round(SAMPLE_RATE * 1.2);
  const tone = loopFrequency(320 + random() * 140);
  let noise = 0;
  for (let index = 0; index < hitLength; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = Math.exp(-4.5 * time);
    noise = noise * 0.72 + (random() * 2 - 1) * 0.28;
    const body =
      Math.sin(2 * Math.PI * tone * time) * 0.5 +
      Math.sin(2 * Math.PI * tone * 1.5 * time) * 0.3 +
      noise * 0.4;
    samples[index] = body * envelope;
  }
  return normalise(samples);
}

const GENERATORS: Record<Layer, (random: () => number) => Float32Array> = {
  bed: bedStem,
  pulse: pulseStem,
  lead: leadStem,
  stinger: stingerStem,
};

export function synthesizeSeedStem(slug: string, layer: Layer): { bytes: Buffer; durationMs: number } {
  const random = seededRandom(`${slug}:${layer}`);
  const samples = GENERATORS[layer](random);
  return { bytes: encodeWav(samples, SAMPLE_RATE), durationMs: DURATION_SECONDS * 1000 };
}

