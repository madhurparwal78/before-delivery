import type { Sport } from './types.js';

export const CSV_HEADER = 't,power,heart_rate,speed';

export interface ActivitySamples {
  sport: Sport;
  start: string | null;
  power: (number | null)[];
  speed: (number | null)[];
}

export type FileFailure =
  | { status: 413; error: 'file_too_large'; message: string }
  | { status: 415; error: 'unsupported_type'; message: string }
  | { status: 422; field: 'file'; message: string };

export function fileTooLarge(maxBytes: number): FileFailure {
  return {
    status: 413,
    error: 'file_too_large',
    message: `This file is larger than ${maxBytes} bytes.`,
  };
}

export function unsupportedType(): FileFailure {
  return {
    status: 415,
    error: 'unsupported_type',
    message: 'Upload a .csv or .json activity file.',
  };
}

function fileError(message: string): FileFailure {
  return { status: 422, field: 'file', message };
}

export type ActivityExtension = 'csv' | 'json';

export function activityExtension(name: string): ActivityExtension | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

export function contentTypeFor(extension: ActivityExtension): string {
  return extension === 'csv' ? 'text/csv' : 'application/json';
}

function validPower(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 2500);
}

function validHeartRate(value: number | null): boolean {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= 250);
}

function validSpeed(value: number | null): boolean {
  return value === null || (Number.isFinite(value) && value >= 0 && value <= 30);
}

function parseIntegerField(text: string): number | null | undefined {
  if (text === '') return null;
  if (!/^-?\d+$/.test(text)) return undefined;
  return Number(text);
}

function parseDecimalField(text: string): number | null | undefined {
  if (text === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  return Number(text);
}

export function parseCsvActivity(text: string, sport: Sport): ActivitySamples | FileFailure {
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0 || lines[0] !== CSV_HEADER) {
    return fileError(`Line 1 must be ${CSV_HEADER}.`);
  }
  const power: (number | null)[] = [];
  const speed: (number | null)[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const fields = (lines[index] as string).split(',');
    const lineNumber = index + 1;
    if (fields.length !== 4) return fileError(`Line ${lineNumber} is not a valid sample.`);
    const t = parseIntegerField(fields[0] as string);
    const powerValue = parseIntegerField(fields[1] as string);
    const heartRate = parseIntegerField(fields[2] as string);
    const speedValue = parseDecimalField(fields[3] as string);
    if (
      t === undefined ||
      t === null ||
      t !== index - 1 ||
      powerValue === undefined ||
      !validPower(powerValue) ||
      heartRate === undefined ||
      !validHeartRate(heartRate) ||
      speedValue === undefined ||
      !validSpeed(speedValue)
    ) {
      return fileError(`Line ${lineNumber} is not a valid sample.`);
    }
    power.push(powerValue);
    speed.push(speedValue);
  }
  if (power.length === 0) return fileError('The file has no samples.');
  return { sport, start: null, power, speed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonActivity(text: string): ActivitySamples | FileFailure {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fileError('The file is not valid activity JSON.');
  }
  if (!isRecord(parsed)) return fileError('The file is not valid activity JSON.');
  const sport = parsed.sport;
  if (sport !== 'bike' && sport !== 'run') return fileError('The file is not valid activity JSON.');
  if (!Array.isArray(parsed.samples)) return fileError('The file is not valid activity JSON.');
  const start = parsed.start;
  if (start !== undefined && start !== null && typeof start !== 'string') {
    return fileError('The file is not valid activity JSON.');
  }
  const samples = parsed.samples as unknown[];
  if (samples.length === 0) return fileError('The file has no samples.');
  const power: (number | null)[] = [];
  const speed: (number | null)[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const number = index + 1;
    if (!isRecord(sample)) return fileError(`Sample ${number} is not a valid sample.`);
    const t = sample.t;
    const powerValue = sample.power === undefined || sample.power === null ? null : sample.power;
    const heartRate =
      sample.heart_rate === undefined || sample.heart_rate === null ? null : sample.heart_rate;
    const speedValue = sample.speed === undefined || sample.speed === null ? null : sample.speed;
    if (
      typeof t !== 'number' ||
      t !== index ||
      typeof powerValue !== 'number' && powerValue !== null ||
      typeof heartRate !== 'number' && heartRate !== null ||
      typeof speedValue !== 'number' && speedValue !== null ||
      !validPower(powerValue as number | null) ||
      !validHeartRate(heartRate as number | null) ||
      !validSpeed(speedValue as number | null)
    ) {
      return fileError(`Sample ${number} is not a valid sample.`);
    }
    power.push(powerValue as number | null);
    speed.push(speedValue as number | null);
  }
  return { sport, start: typeof start === 'string' ? start : null, power, speed };
}

export function isFileFailure(value: ActivitySamples | FileFailure): value is FileFailure {
  return 'status' in value;
}

export function checkChannels(samples: ActivitySamples): FileFailure | null {
  if (samples.sport === 'bike' && samples.power.some((value) => value === null)) {
    return fileError('Every sample needs power for a bike file.');
  }
  if (samples.sport === 'run' && samples.speed.some((value) => value === null)) {
    return fileError('Every sample needs speed for a run file.');
  }
  return null;
}

export function checkSampleCount(samples: ActivitySamples, maxSamples: number): FileFailure | null {
  const count = samples.sport === 'bike' ? samples.power.length : samples.speed.length;
  if (count > maxSamples) {
    return fileError(`This file has more than ${maxSamples} samples.`);
  }
  return null;
}
