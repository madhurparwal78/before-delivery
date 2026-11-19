import { Decimal } from '../domain/decimal';
import { copy } from '../domain/copy';
import { countCharacters } from '../domain/text';
import { FieldCollector } from '../http/problem';

export { FieldCollector };

export function requiredText(
  body: Record<string, unknown>,
  key: string,
  problems: FieldCollector,
  maxCharacters = 120,
): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    problems.add(key, copy.emptyField);
    return '';
  }
  if (countCharacters(value) > maxCharacters) {
    problems.add(key, copy.emptyField);
    return '';
  }
  return value.trim();
}

export function optionalText(
  body: Record<string, unknown>,
  key: string,
  problems: FieldCollector,
  maxCharacters: number,
): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    problems.add(key, copy.emptyField);
    return null;
  }
  if (countCharacters(value) > maxCharacters) {
    problems.add(key, copy.emptyField);
    return null;
  }
  return value;
}

export function readWhole(body: Record<string, unknown>, key: string, problems: FieldCollector): number | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    problems.add(key, copy.emptyField);
    return null;
  }
  return value;
}

export function readBoolean(body: Record<string, unknown>, key: string, problems: FieldCollector): boolean | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    problems.add(key, copy.emptyField);
    return null;
  }
  return value;
}

/** Every decimal travels as a string. */
export function readDecimal(
  body: Record<string, unknown>,
  key: string,
  problems: FieldCollector,
  message: string,
): Decimal | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) {
    problems.add(key, message);
    return null;
  }
  return new Decimal(value);
}

export function readBaseVersion(body: Record<string, unknown>, problems: FieldCollector): number | null {
  const value = body.baseVersion;
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    problems.add('baseVersion', copy.emptyField);
    return null;
  }
  return value;
}

export function readBaseVersionParameter(query: URLSearchParams): number | null {
  const value = query.get('baseVersion');
  if (value === null || value === '') return null;
  if (!/^\d+$/.test(value)) return -1;
  return Number(value);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requiredEmail(body: Record<string, unknown>, key: string, problems: FieldCollector): string {
  const value = body[key];
  if (typeof value !== 'string' || !EMAIL.test(value.trim())) {
    problems.add(key, copy.emptyField);
    return '';
  }
  return value.trim().toLowerCase();
}
