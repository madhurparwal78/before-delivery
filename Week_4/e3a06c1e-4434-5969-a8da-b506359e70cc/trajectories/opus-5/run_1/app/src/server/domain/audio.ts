import { createHash } from 'node:crypto';
import { splitWords } from '../../shared/text.js';
import type { Voice } from '../../shared/types.js';
import { SAMPLE_RATE } from './spectrum.js';

export const WAV_HEADER_BYTES = 44;

export interface WavInfo {
  readonly channels: number;
  readonly sampleRate: number;
  readonly dataOffset: number;
  readonly dataBytes: number;
}

/** Accepts only RIFF WAV of 16-bit PCM at 16 kHz with one or two channels. */
export const readWav = (buffer: Buffer): WavInfo | null => {
  if (buffer.length < 12) return null;
  if (buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let format = 0;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('latin1', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > buffer.length) return null;
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bits = buffer.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataOffset = body;
      dataBytes = Math.min(size, buffer.length - body);
    }
    offset = body + size + (size % 2);
  }
  if (dataOffset < 0) return null;
  if (format !== 1 || bits !== 16 || sampleRate !== SAMPLE_RATE) return null;
  if (channels !== 1 && channels !== 2) return null;
  if (dataBytes % (2 * channels) !== 0) return null;
  return { channels, sampleRate, dataOffset, dataBytes };
};

/** A canonical 44-byte header followed by the sample data. */
export const buildWav = (pcm: Buffer, channels: number): Buffer => {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

const writeSamples = (frames: number, channels: number, sample: (index: number, channel: number) => number): Buffer => {
  const pcm = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const value = Math.max(-1, Math.min(1, sample(i, c)));
      pcm.writeInt16LE(Math.round(value * 32767), (i * channels + c) * 2);
    }
  }
  return pcm;
};

/** The bundled fixture: 10.000 s of a 1 kHz sine at half full scale, mono. */
export const toneFixture = (): Buffer =>
  buildWav(
    writeSamples(SAMPLE_RATE * 10, 1, (i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE)),
    1,
  );

const formantPair = (slot: number): [number, number] => {
  const first = [320, 450, 600, 730, 520][slot % 5] as number;
  const second = [2200, 1700, 1100, 1300, 1900][slot % 5] as number;
  return [first, second];
};

const envelope = (position: number): number => Math.sin(Math.PI * Math.min(1, Math.max(0, position))) ** 0.7;

/** Deterministic speech-like audio used for the seed sessions. */
export const seedAudio = (durationMs: number, channels: number, seed: string): Buffer => {
  const digest = createHash('sha256').update(seed).digest();
  const frames = Math.round((durationMs * SAMPLE_RATE) / 1000);
  const syllableFrames = Math.round(SAMPLE_RATE * 0.24);
  return buildWav(
    writeSamples(frames, channels, (i, channel) => {
      const syllable = Math.floor(i / syllableFrames);
      const within = (i % syllableFrames) / syllableFrames;
      const slot = (digest[syllable % digest.length] as number) % 5;
      const [f1, f2] = formantPair(slot);
      const pitch = 95 + ((digest[(syllable + 7) % digest.length] as number) % 40);
      const t = i / SAMPLE_RATE;
      const buzz = Math.sin(2 * Math.PI * pitch * t) * 0.35 + Math.sin(4 * Math.PI * pitch * t) * 0.12;
      const voiced =
        Math.sin(2 * Math.PI * f1 * t) * 0.3 + Math.sin(2 * Math.PI * f2 * t) * 0.12 + buzz;
      const pan = channels === 2 ? (channel === 0 ? 0.92 : 0.78) : 1;
      return voiced * envelope(within) * 0.55 * pan;
    }),
    channels,
  );
};

/** duration_ms is the word count x 300. */
export const synthesisDurationMs = (text: string): number => splitWords(text).length * 300;

const voiceTilt: Record<Voice, number> = { lumen: 1.18, basalt: 0.82 };

/** Procedural formant render: the same text and voice always produce identical bytes. */
export const renderSynthesis = (text: string, voice: Voice): Buffer => {
  const words = splitWords(text);
  const durationMs = words.length * 300;
  const frames = Math.round((durationMs * SAMPLE_RATE) / 1000);
  const wordFrames = Math.round(SAMPLE_RATE * 0.3);
  const tilt = voiceTilt[voice];
  const digests = words.map((word) => createHash('sha256').update(`${voice}:${word}`).digest());
  return buildWav(
    writeSamples(frames, 1, (i) => {
      const wordIndex = Math.min(words.length - 1, Math.floor(i / wordFrames));
      const digest = digests[wordIndex] as Buffer;
      const within = (i % wordFrames) / wordFrames;
      const slot = (digest[0] as number) % 5;
      const [f1, f2] = formantPair(slot);
      const pitch = (100 + ((digest[1] as number) % 50)) * tilt;
      const t = i / SAMPLE_RATE;
      const tone =
        Math.sin(2 * Math.PI * f1 * tilt * t) * 0.32 +
        Math.sin(2 * Math.PI * f2 * tilt * t) * 0.14 +
        Math.sin(2 * Math.PI * pitch * t) * 0.3;
      return tone * envelope(within) * 0.6;
    }),
    1,
  );
};

export const audioMsFromSamples = (samplesPerChannel: number): number =>
  Math.floor((samplesPerChannel * 1000) / SAMPLE_RATE);

/** Averages channels into one sample per frame, as the recognizer sees them. */
export const averageChannels = (pcm: Buffer, channels: number): Float64Array => {
  const frames = Math.floor(pcm.length / (2 * channels));
  const mono = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let total = 0;
    for (let c = 0; c < channels; c += 1) total += pcm.readInt16LE((i * channels + c) * 2) / 32768;
    mono[i] = total / channels;
  }
  return mono;
};

export const sliceWav = (pcm: Buffer, channels: number, startMs: number, endMs: number): Buffer => {
  const frameBytes = 2 * channels;
  const totalFrames = Math.floor(pcm.length / frameBytes);
  const from = Math.min(totalFrames, Math.floor((startMs * SAMPLE_RATE) / 1000));
  const to = Math.min(totalFrames, Math.ceil((endMs * SAMPLE_RATE) / 1000));
  const slice = pcm.subarray(from * frameBytes, Math.max(from, to) * frameBytes);
  return buildWav(Buffer.from(slice), channels);
};
