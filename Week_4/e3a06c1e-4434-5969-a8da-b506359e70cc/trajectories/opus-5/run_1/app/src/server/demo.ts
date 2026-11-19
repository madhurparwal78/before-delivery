import { averageChannels, readWav } from './domain/audio.js';
import { ROWS_PER_SECOND, SpectrumStream } from './domain/spectrum.js';
import { seedSessionAudio, seedSessions } from './seeddata.js';

export interface DemoSpectrum {
  readonly frame_rate: number;
  readonly rows: readonly number[][];
}

let cached: DemoSpectrum | null = null;

/** The public demo spectrum is the spectrum of the Seed dictation 01 audio. */
export const demoSpectrum = (): DemoSpectrum => {
  if (cached !== null) return cached;
  const session = seedSessions[0];
  if (session === undefined) throw new Error('no seed session to derive the demo spectrum from');
  const wav = seedSessionAudio(session);
  const info = readWav(wav);
  if (info === null) throw new Error('seed audio is not a readable WAV');
  const stream = new SpectrumStream(Number.POSITIVE_INFINITY);
  stream.push(averageChannels(wav.subarray(info.dataOffset, info.dataOffset + info.dataBytes), info.channels));
  cached = { frame_rate: ROWS_PER_SECOND, rows: stream.rows };
  return cached;
};
