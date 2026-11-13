import type { LengthUnit, Tolerance } from './api';
import { FIELD_MESSAGES } from './messages';
import { MM_PER_INCH } from './units';

/** A problem found in one request field: the message to show under that field. */
export class FieldProblem extends Error {}

const MAX_MM = 10000;
const NUMBER = String.raw`(?:\d+\/\d+|\d+(?:\.\d+)?|\.\d+)`;
const LENGTH = new RegExp(String.raw`^\s*(-|−)?\s*(${NUMBER})\s*(mm|in)?\s*$`, 'i');

function magnitude(text: string): number | undefined {
  if (text.includes('/')) {
    const [numerator, denominator] = text.split('/').map(Number) as [number, number];
    return denominator === 0 ? undefined : numerator / denominator;
  }
  return Number(text);
}

function scale(unit: string | undefined, fallback: LengthUnit): number {
  return (unit?.toLowerCase() ?? fallback) === 'in' ? MM_PER_INCH : 1;
}

/** The dimension input grammar: a number or fraction, an optional mm or in suffix; JSON numbers are millimetres. */
function parseSigned(input: unknown, fallback: LengthUnit): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new FieldProblem(FIELD_MESSAGES.grammar);
    return input;
  }
  const match = typeof input === 'string' ? LENGTH.exec(input) : null;
  const value = match ? magnitude(match[2] as string) : undefined;
  if (!match || value === undefined) throw new FieldProblem(FIELD_MESSAGES.grammar);
  const sign = match[1] ? -1 : 1;
  return sign * value * scale(match[3], fallback);
}

/** A negative sign is not part of the grammar for lengths; only coordinates take one. */
function parseUnsigned(input: unknown, fallback: LengthUnit): number {
  if (typeof input === 'string' && /^\s*(-|−)/.test(input)) throw new FieldProblem(FIELD_MESSAGES.grammar);
  return parseSigned(input, fallback);
}

/** A length greater than 0 and at most 10000 mm (dimensions, diameters, radii, depths). */
export function parseLength(input: unknown, unit: LengthUnit): number {
  const mm = typeof input === 'number' ? parseSigned(input, unit) : parseUnsigned(input, unit);
  if (!(mm > 0 && mm <= MAX_MM)) throw new FieldProblem(FIELD_MESSAGES.lengthRange);
  return mm;
}

/** A coordinate or offset from -10000 to 10000 mm. */
export function parseCoordinate(input: unknown, unit: LengthUnit): number {
  const mm = parseSigned(input, unit);
  if (!(mm >= -MAX_MM && mm <= MAX_MM)) throw new FieldProblem(FIELD_MESSAGES.coordinateRange);
  return mm;
}

export function parseAngle(input: unknown): number {
  const degrees = typeof input === 'number' ? input : typeof input === 'string' && input.trim() !== '' ? Number(input) : NaN;
  if (!Number.isFinite(degrees)) throw new FieldProblem(FIELD_MESSAGES.angle);
  return degrees;
}

function toleranceNumber(input: unknown, unit: LengthUnit): number {
  let mm: number;
  try {
    mm = parseUnsigned(input, unit);
  } catch {
    throw new FieldProblem(FIELD_MESSAGES.tolerance);
  }
  if (mm < 0 || mm > MAX_MM) throw new FieldProblem(FIELD_MESSAGES.tolerance);
  return mm;
}

const SYMMETRIC = new RegExp(String.raw`^\s*(?:±|\+-)\s*(${NUMBER})\s*(mm|in)?\s*$`, 'i');
const ASYMMETRIC = new RegExp(String.raw`^\s*\+\s*(${NUMBER})\s*\/\s*(?:-|−)\s*(${NUMBER})\s*(mm|in)?\s*$`, 'i');

function parseToleranceText(text: string, unit: LengthUnit): Tolerance {
  const symmetric = SYMMETRIC.exec(text);
  if (symmetric) {
    const mm = toleranceNumber(`${symmetric[1]}${symmetric[2] ?? ''}`, unit);
    return { kind: 'symmetric', plus_mm: mm, minus_mm: mm };
  }
  const asymmetric = ASYMMETRIC.exec(text);
  if (asymmetric) {
    const suffix = asymmetric[3] ?? '';
    return {
      kind: 'asymmetric',
      plus_mm: toleranceNumber(`${asymmetric[1]}${suffix}`, unit),
      minus_mm: toleranceNumber(`${asymmetric[2]}${suffix}`, unit),
    };
  }
  throw new FieldProblem(FIELD_MESSAGES.tolerance);
}

/** Request tolerance: an object, the text grammar, or null/empty to clear. Returns null to clear. */
export function parseTolerance(input: unknown, unit: LengthUnit): Tolerance | null {
  if (input === null || input === '') return null;
  if (typeof input === 'string') return parseToleranceText(input, unit);
  if (typeof input === 'object' && !Array.isArray(input)) {
    const object = input as Record<string, unknown>;
    if (object['kind'] === 'symmetric') {
      const mm = toleranceNumber(object['value'], unit);
      return { kind: 'symmetric', plus_mm: mm, minus_mm: mm };
    }
    if (object['kind'] === 'asymmetric') {
      return { kind: 'asymmetric', plus_mm: toleranceNumber(object['plus'], unit), minus_mm: toleranceNumber(object['minus'], unit) };
    }
  }
  throw new FieldProblem(FIELD_MESSAGES.tolerance);
}
