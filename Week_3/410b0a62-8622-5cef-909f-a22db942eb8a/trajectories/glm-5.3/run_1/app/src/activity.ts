import { ValidationError } from './errors.js';
import type { Sport } from './types.js';

export const CSV_HEADER = 't,power,heart_rate,speed';

export interface ParsedFile {
  sport: Sport;
  samples: { t: number; power?: number; speed?: number }[];
}

export type FileFailure =
  | { stage: 'header' }
  | { stage: 'json' }
  | { stage: 'noSamples' }
  | { stage: 'row'; line: number }
  | { stage: 'jsonSample'; index: number }
  | { stage: 'channel'; channel: 'power' | 'speed' }
  | { stage: 'tooManySamples' };

function csvValueInt(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || raw === '') return null;
  if (!/^-?\d+$/.test(raw.trim())) return NaN as unknown as number;
  const v = Number(raw.trim());
  if (v < min || v > max) return NaN as unknown as number;
  return v;
}

function csvValueDecimal(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || raw === '') return null;
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) return NaN as unknown as number;
  const v = Number(raw.trim());
  if (v < min || v > max) return NaN as unknown as number;
  return v;
}

/**
 * Parses CSV bytes. Assumes the file-size, extension and request-field checks
 * have already passed. Throws ValidationError for content failures.
 */
export function parseCsvFile(bytes: Buffer): { samples: { t: number; power: number | null; speed: number | null; heart_rate: number | null }[] } {
  const text = bytes.toString('utf8');
  const normalised = text.replace(/\r\n/g, '\n');
  let lines = normalised.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines = lines.slice(0, -1);
  if (lines.length === 0 || lines[0] !== CSV_HEADER) {
    throw new ValidationError({ file: 'Line 1 must be t,power,heart_rate,speed.' });
  }
  const samples: { t: number; power: number | null; speed: number | null; heart_rate: number | null }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === '' && i === lines.length - 1) continue;
    const parts = line.split(',');
    if (parts.length !== 4) throw badCsvLine(i + 1);
    const t = Number(parts[0]?.trim());
    if (!Number.isInteger(t)) throw badCsvLine(i + 1);
    const power = csvValueInt(parts[1], 0, 2500);
    const hr = csvValueInt(parts[2], 0, 250);
    const speed = csvValueDecimal(parts[3], 0, 30);
    if (Number.isNaN(power) || Number.isNaN(hr) || Number.isNaN(speed)) throw badCsvLine(i + 1);
    samples.push({ t, power, speed, heart_rate: hr });
  }
  if (samples.length === 0) throw new ValidationError({ file: 'The file has no samples.' });
  checkTimeline(samples.map((s) => s.t), (line) => badCsvLine(line));
  return { samples };
}

function badCsvLine(line: number): ValidationError {
  return new ValidationError({ file: `Line ${line} is not a valid sample.` });
}

function checkTimeline(ts: number[], fail: (line: number) => ValidationError): void {
  for (let i = 0; i < ts.length; i++) {
    if (ts[i] !== i) throw fail(i + 2);
  }
}

interface JsonSampleRaw {
  t?: unknown;
  power?: unknown;
  heart_rate?: unknown;
  speed?: unknown;
}

export function parseJsonFile(
  bytes: Buffer
): { sport: unknown; start?: unknown; samples: { t: number; power: number | null; speed: number | null; heart_rate: number | null }[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ValidationError({ file: 'The file is not valid activity JSON.' });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ValidationError({ file: 'The file is not valid activity JSON.' });
  }
  const obj = parsed as { sport?: unknown; start?: unknown; samples?: unknown };
  if (!Array.isArray(obj.samples)) {
    throw new ValidationError({ file: 'The file has no samples.' });
  }
  const rawSamples = obj.samples as unknown[];
  const samples: { t: number; power: number | null; speed: number | null; heart_rate: number | null }[] = [];
  for (let i = 0; i < rawSamples.length; i++) {
    const raw = rawSamples[i];
    if (typeof raw !== 'object' || raw === null) throw badJsonSample(i + 1);
    const r = raw as JsonSampleRaw;
    const t = r.t;
    if (typeof t !== 'number' || !Number.isInteger(t)) throw badJsonSample(i + 1);
    const power = channelValue(r.power, 0, 2500, true);
    const hr = channelValue(r.heart_rate, 0, 250, true);
    const speed = channelValue(r.speed, 0, 30, false);
    if (Number.isNaN(power) || Number.isNaN(hr) || Number.isNaN(speed)) throw badJsonSample(i + 1);
    samples.push({ t, power, speed, heart_rate: hr });
  }
  if (samples.length === 0) throw new ValidationError({ file: 'The file has no samples.' });
  for (let i = 0; i < samples.length; i++) {
    if (samples[i]!.t !== i) throw badJsonSample(i + 1);
  }
  return { sport: obj.sport, start: obj.start, samples };
}

function badJsonSample(n: number): ValidationError {
  return new ValidationError({ file: `Sample ${n} is not a valid sample.` });
}

function channelValue(v: unknown, min: number, max: number, integer: boolean): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number') return NaN as unknown as number;
  if (integer && !Number.isInteger(v)) return NaN as unknown as number;
  if (v < min || v > max) return NaN as unknown as number;
  return v;
}

export function checkChannel(
  sport: Sport,
  samples: readonly { power: number | null; speed: number | null }[]
): void {
  if (sport === 'bike') {
    for (const s of samples) {
      if (s.power === null) {
        throw new ValidationError({ file: 'Every sample needs power for a bike file.' });
      }
    }
  } else {
    for (const s of samples) {
      if (s.speed === null) {
        throw new ValidationError({ file: 'Every sample needs speed for a run file.' });
      }
    }
  }
}

export function checkSampleCount(count: number, max: number): void {
  if (count > max) {
    throw new ValidationError({ file: `This file has more than ${max} samples.` });
  }
}
