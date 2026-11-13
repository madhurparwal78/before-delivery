import type { Sport } from '../../shared/types.js';
import { validation } from '../errors.js';
import { config } from '../config.js';
import { parseStart } from './zones.js';

export type ActivityFormat = 'csv' | 'json';

export interface ParsedActivity {
  sport: Sport;
  /** The raw `start` of a JSON file, when it has one. */
  start: string | null;
  /** Power in watts for a bike file, speed in metres per second for a run file, one value per second. */
  values: number[];
}

const CSV_HEADER = 't,power,heart_rate,speed';
/** A whole number, written with or without a zero fraction (`200` or `200.0`). */
const WHOLE_NUMBER = /^\d+(?:\.0*)?$/;

export function activityFormat(fileName: string): ActivityFormat | null {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return extension === 'csv' || extension === 'json' ? extension : null;
}

const fileError = (message: string) => validation({ file: message });

interface Sample {
  power: number | null;
  speed: number | null;
}

const integerIn = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

function csvSamples(text: string): Sample[] {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== CSV_HEADER) throw fileError('Line 1 must be t,power,heart_rate,speed.');
  const rows = lines.slice(1);
  if (rows.at(-1) === '') rows.pop();
  if (rows.length === 0) throw fileError('The file has no samples.');
  return rows.map((row, index) => {
    const bad = () => fileError(`Line ${index + 2} is not a valid sample.`);
    const fields = row.split(',');
    if (fields.length !== 4) throw bad();
    const [t, power, heartRate, speed] = fields as [string, string, string, string];
    if (!/^\d+$/.test(t) || Number(t) !== index) throw bad();
    if (power !== '' && !(WHOLE_NUMBER.test(power) && integerIn(Number(power), 2500))) throw bad();
    if (heartRate !== '' && !(WHOLE_NUMBER.test(heartRate) && integerIn(Number(heartRate), 250))) throw bad();
    if (speed !== '' && !(/^(\d+\.?\d*|\.\d+)$/.test(speed) && Number(speed) <= 30)) throw bad();
    return { power: power === '' ? null : Number(power), speed: speed === '' ? null : Number(speed) };
  });
}

interface JsonActivity {
  sport: Sport;
  start: string | null;
  samples: unknown[];
}

function readJson(bytes: Uint8Array): JsonActivity {
  const invalid = () => fileError('The file is not valid activity JSON.');
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw invalid();
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) throw invalid();
  const { sport, start, samples } = doc as Record<string, unknown>;
  if ((sport !== 'bike' && sport !== 'run') || !Array.isArray(samples)) throw invalid();
  if (start !== undefined && (typeof start !== 'string' || parseStart(start, 'UTC') === null)) throw invalid();
  return { sport, start: start ?? null, samples };
}

function jsonSamples(samples: unknown[]): Sample[] {
  if (samples.length === 0) throw fileError('The file has no samples.');
  return samples.map((raw, index) => {
    const bad = () => fileError(`Sample ${index + 1} is not a valid sample.`);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad();
    const { t, power = null, heart_rate: heartRate = null, speed = null } = raw as Record<string, unknown>;
    if (t !== index) throw bad();
    if (power !== null && !integerIn(power, 2500)) throw bad();
    if (heartRate !== null && !integerIn(heartRate, 250)) throw bad();
    if (speed !== null && !(typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 && speed <= 30)) throw bad();
    return { power, speed };
  });
}

/** A JSON file's own start, when its content allows reading one; the request's date is used otherwise. */
export function jsonStart(bytes: Uint8Array): string | null {
  try {
    const doc = JSON.parse(new TextDecoder().decode(bytes)) as { start?: unknown };
    return typeof doc.start === 'string' ? doc.start : null;
  } catch {
    return null;
  }
}

/** The file's own sport: the request's for a CSV, the document's for a JSON file. */
type ActivitySource = { format: 'csv'; sport: Sport } | { format: 'json' };

/** File checks 4 to 7, in the published order. The first failure answers. */
export function parseActivity(source: ActivitySource, bytes: Uint8Array): ParsedActivity {
  let sport: Sport;
  let start: string | null = null;
  let samples: Sample[];
  if (source.format === 'csv') {
    sport = source.sport;
    samples = csvSamples(new TextDecoder().decode(bytes));
  } else {
    const doc = readJson(bytes);
    sport = doc.sport;
    start = doc.start;
    samples = jsonSamples(doc.samples);
  }
  const channel = sport === 'bike' ? 'power' : 'speed';
  const values: number[] = [];
  for (const sample of samples) {
    const value = sample[channel];
    if (value === null) throw fileError(`Every sample needs ${channel} for a ${sport} file.`);
    values.push(value);
  }
  if (values.length > config.activityMaxSamples) throw fileError(`This file has more than ${config.activityMaxSamples} samples.`);
  return { sport, start, values };
}
