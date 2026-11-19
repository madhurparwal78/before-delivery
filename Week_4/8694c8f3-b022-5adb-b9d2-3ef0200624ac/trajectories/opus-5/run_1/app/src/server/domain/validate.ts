import { fieldError } from '../errors.js';
import { asNumber, asNumberTriple, asString } from '../input.js';
import {
  hasAtMostOneDecimal,
  rangeMessage,
  RANGES,
  type NumberRange,
} from '../../shared/domain.js';
import type { Vec3 } from '../../shared/types.js';

/** Every value range in the brief is decided here. */

export function numberInRange(field: string, value: unknown, range: NumberRange): number {
  const parsed = asNumber(value);
  if (parsed === null) throw fieldError(field, rangeMessage(range));
  if (parsed < range.min || parsed > range.max) throw fieldError(field, rangeMessage(range));
  return parsed;
}

export function vec3InRange(field: string, value: unknown, range: NumberRange): Vec3 {
  const triple = asNumberTriple(value);
  if (triple === null) throw fieldError(field, rangeMessage(range));
  for (const component of triple) {
    if (component < range.min || component > range.max) throw fieldError(field, rangeMessage(range));
  }
  return triple;
}

export function textInLength(field: string, value: unknown, min: number, max: number, label: string): string {
  const text = asString(value);
  if (text === null || text.length < min || text.length > max) {
    throw fieldError(field, `${label} must be ${min} to ${max} characters`);
  }
  return text;
}

export function sourceText(field: string, value: unknown): string {
  const text = asString(value);
  if (text === null) throw fieldError(field, 'Source must be text');
  if (Buffer.byteLength(text, 'utf8') > 100_000) {
    throw fieldError(field, 'Source must be at most 100000 bytes');
  }
  return text;
}

export function bpmValue(field: string, value: unknown): number {
  const parsed = numberInRange(field, value, RANGES.bpm);
  if (!hasAtMostOneDecimal(parsed)) throw fieldError(field, 'BPM takes at most one decimal place');
  return Math.round(parsed * 10) / 10;
}
