import { ApiError, FIELD_MESSAGE } from './errors.js';
import { LIMITS } from '../shared/constants.js';

type Stage = 'types' | 'depth' | 'forbidden' | 'range' | 'cross' | 'aggregate';

const STAGE_ORDER: Stage[] = ['types', 'depth', 'forbidden', 'range', 'cross', 'aggregate'];

export class Problems {
  private readonly byStage = new Map<Stage, Set<string>>();

  add(stage: Stage, path: string): void {
    const existing = this.byStage.get(stage);
    if (existing === undefined) this.byStage.set(stage, new Set([path]));
    else existing.add(path);
  }

  /** Throws the first failing validation stage with all of that stage's field paths. */
  flush(): void {
    for (const stage of STAGE_ORDER) {
      const paths = this.byStage.get(stage);
      if (paths === undefined || paths.size === 0) continue;
      const fields: Record<string, string> = {};
      for (const path of [...paths].sort()) {
        if (stage === 'types' && [...paths].some((parent) => parent !== path && (path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`)))) continue;
        fields[path] = FIELD_MESSAGE;
      }
      throw new ApiError('INVALID_FIELDS', fields);
    }
  }
}

export function requireJsonObject(root: unknown): Record<string, unknown> {
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new ApiError('INVALID_JSON');
  }
  return root as Record<string, unknown>;
}

function join(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

export function rejectUnknown(
  object: Record<string, unknown>,
  allowed: string[],
  base: string,
  problems: Problems,
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) problems.add('types', join(base, key));
  }
}

export function readString(
  object: Record<string, unknown>,
  key: string,
  base: string,
  problems: Problems,
): string {
  const value = object[key];
  if (typeof value !== 'string') {
    problems.add('types', join(base, key));
    return '';
  }
  return value;
}

export function readInteger(
  object: Record<string, unknown>,
  key: string,
  base: string,
  problems: Problems,
): number {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    problems.add('types', join(base, key));
    return 0;
  }
  return value;
}

export function readNullableInteger(
  object: Record<string, unknown>,
  key: string,
  base: string,
  problems: Problems,
): number | null {
  const value = object[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    problems.add('types', join(base, key));
    return null;
  }
  return value;
}

export function readNullableString(
  object: Record<string, unknown>,
  key: string,
  base: string,
  problems: Problems,
): string | null {
  const value = object[key];
  if (value === null) return null;
  if (typeof value !== 'string') {
    problems.add('types', join(base, key));
    return null;
  }
  return value;
}

export function readBoolean(
  object: Record<string, unknown>,
  key: string,
  base: string,
  problems: Problems,
): boolean {
  const value = object[key];
  if (typeof value !== 'boolean') {
    problems.add('types', join(base, key));
    return false;
  }
  return value;
}

export function readArray(
  object: Record<string, unknown>,
  key: string,
  base: string,
  problems: Problems,
): unknown[] {
  const value = object[key];
  if (!Array.isArray(value)) {
    problems.add('types', join(base, key));
    return [];
  }
  return value;
}

export function readObject(
  object: Record<string, unknown>,
  key: string,
  base: string,
  problems: Problems,
): Record<string, unknown> {
  const value = object[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    problems.add('types', join(base, key));
    return {};
  }
  return value as Record<string, unknown>;
}

export function elementObject(
  value: unknown,
  path: string,
  problems: Problems,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    problems.add('types', path);
    return {};
  }
  return value as Record<string, unknown>;
}

export function checkDepth(root: unknown, problems: Problems): void {
  const measure = (value: unknown, level: number): void => {
    if (value === null || typeof value !== 'object') return;
    if (level > LIMITS.maxDepth) {
      problems.add('depth', 'depth');
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) measure(item, level + 1);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) measure(item, level + 1);
    }
  };
  measure(root, 1);
}

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028]/u;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function checkSurrogates(root: unknown, problems: Problems, base: string): void {
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      if (LONE_SURROGATE.test(value)) problems.add('forbidden', path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        walk(item, join(path, key));
      }
    }
  };
  walk(root, base);
}

export function checkNoControlCharacters(value: string, path: string, problems: Problems): void {
  if (CONTROL_PATTERN.test(value)) problems.add('forbidden', path);
}

export function codePoints(value: string): number {
  return [...value].length;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

const EMAIL_PATTERN = /^[^\s@"'(),:;<>[\\\]]+@[^\s@.]+(\.[^\s@.]+)+$/u;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function checkEmail(value: string, path: string, problems: Problems): void {
  const normalized = normalizeEmail(value);
  if (codePoints(normalized) > LIMITS.maxEmailCodePoints || !EMAIL_PATTERN.test(normalized)) {
    problems.add('range', path);
  }
}

export function checkPassword(value: string, path: string, problems: Problems): void {
  const bytes = utf8Bytes(value);
  if (bytes < LIMITS.minPasswordBytes || bytes > LIMITS.maxPasswordBytes) {
    problems.add('range', path);
  }
}

export function checkRange(
  value: number,
  min: number,
  max: number,
  path: string,
  problems: Problems,
): void {
  if (value < min || value > max) problems.add('range', path);
}

export function checkEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  path: string,
  problems: Problems,
): void {
  if (!allowed.includes(value as T)) problems.add('range', path);
}

export function checkTextLength(
  value: string,
  min: number,
  max: number,
  path: string,
  problems: Problems,
): void {
  const length = codePoints(value);
  if (length < min || length > max) problems.add('range', path);
}

/** Parses a required nonnegative decimal integer query parameter. */
export function queryInteger(raw: string | null, name: string, problems: Problems): number {
  if (raw === null || !/^\d+$/.test(raw)) {
    problems.add('types', name);
    return 0;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    problems.add('range', name);
    return 0;
  }
  return value;
}
