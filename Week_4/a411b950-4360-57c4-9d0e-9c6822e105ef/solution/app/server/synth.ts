// Seed stems are synthesized here: mono 16-bit WAV, 22,050 Hz, exactly 8 seconds, looping cleanly,
// fading in over the first half second and peaking at most a quarter of full scale.

import type { Layer } from "../shared/credits.js";

const RATE = 22_050;
const SECONDS = 8;
const FRAMES = RATE * SECONDS;
const PEAK = 0.24;
const FADE_FRAMES = RATE / 2;

export interface Voice {
  /** Root frequency in hertz. */
  root: number;
  /** Beats in the 8-second loop. */
  beats: number;
  /** Scale degrees (semitones above the root) the lead walks through. */
  melody: number[];
  seed: number;
}

/** A frequency rounded so it completes whole cycles in the loop: the loop point never clicks. */
const looped = (frequency: number): number => Math.round(frequency * SECONDS) / SECONDS;
const semitone = (root: number, steps: number): number => root * 2 ** (steps / 12);

function noise(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

function bed(voice: Voice, t: number): number {
  const shimmer = 0.75 + 0.25 * Math.sin(2 * Math.PI * (1 / SECONDS) * t);
  return shimmer * (
    Math.sin(2 * Math.PI * looped(voice.root) * t)
    + 0.6 * Math.sin(2 * Math.PI * looped(semitone(voice.root, 7)) * t)
    + 0.35 * Math.sin(2 * Math.PI * looped(voice.root * 2) * t + 0.4)
  );
}

function pulse(voice: Voice, t: number, random: () => number): number {
  const beat = SECONDS / voice.beats;
  const since = t % beat;
  const accent = Math.floor(t / beat) % 4 === 0 ? 1 : 0.6;
  const body = Math.sin(2 * Math.PI * (voice.root * 2) * since * (1 - since * 2)) * Math.exp(-since * 28);
  const tick = random() * Math.exp(-since * 90) * 0.5;
  return accent * (body + tick);
}

function lead(voice: Voice, t: number): number {
  const noteLength = SECONDS / voice.melody.length;
  const index = Math.floor(t / noteLength);
  const since = t - index * noteLength;
  const frequency = semitone(voice.root * 4, voice.melody[index] ?? 0);
  const phase = (frequency * since) % 1;
  const triangle = 4 * Math.abs(phase - 0.5) - 1;
  const envelope = Math.min(1, since / 0.04) * Math.exp(-since * 1.6);
  return triangle * envelope;
}

function stinger(voice: Voice, t: number, random: () => number): number {
  const hits = [0.5, 4.5];
  let value = 0;
  for (const at of hits) {
    const since = t - at;
    if (since < 0 || since > 1.5) continue;
    const thump = Math.sin(2 * Math.PI * voice.root * since * (1 - since * 0.4)) * Math.exp(-since * 5);
    const crash = random() * Math.exp(-since * 9);
    value += thump + 0.7 * crash;
  }
  return value;
}

function wav(samples: Float64Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => data.writeInt16LE(Math.round(sample * 32_767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function synthesizeStem(voice: Voice, layer: Layer): Buffer {
  const random = noise(voice.seed + layer.length * 7919);
  const samples = new Float64Array(FRAMES);
  for (let i = 0; i < FRAMES; i += 1) {
    const t = i / RATE;
    const raw = layer === "bed" ? bed(voice, t)
      : layer === "pulse" ? pulse(voice, t, random)
      : layer === "lead" ? lead(voice, t)
      : stinger(voice, t, random);
    const fadeIn = Math.min(1, i / FADE_FRAMES);
    const fadeOut = Math.min(1, (FRAMES - 1 - i) / (RATE * 0.05));
    samples[i] = raw * fadeIn * fadeOut;
  }
  const loudest = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  return wav(samples.map((value) => (value / loudest) * PEAK));
}
