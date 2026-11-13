import { formatMl, type Ml, parseMl } from '../../domain/decimal.ts';
import { ValidationError } from '../../domain/errors.ts';

/** Field validation shared by the endpoints that take ML figures and text. */

const MAX_VOLUME_ML = 500_000n;
const MAX_CAP_ML_DAY = 10_000_000n;

export function requireVolumeMl(field: string, input: unknown): Ml {
  const value = parseMl(input);
  if (value === null || value <= 0n || value > MAX_VOLUME_ML) {
    throw ValidationError.field(field, `Enter a volume from 0.001 to ${formatMl(MAX_VOLUME_ML)} ML.`);
  }
  return value;
}

export function requireCapMlDay(field: string, input: unknown): Ml {
  const value = parseMl(input);
  if (value === null || value <= 0n || value > MAX_CAP_ML_DAY) {
    throw ValidationError.field(field, `Enter a cap from 0.001 to ${formatMl(MAX_CAP_ML_DAY)} ML/day.`);
  }
  return value;
}

export function requireText(field: string, input: unknown, min: number, max: number, label: string): string {
  const value = typeof input === 'string' ? input.trim() : '';
  if (value.length < min || value.length > max) {
    throw ValidationError.field(field, `${label} is ${min} to ${max} characters.`);
  }
  return value;
}
