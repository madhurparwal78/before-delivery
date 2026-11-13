/**
 * Field reading and the field error copy. Lengths count Unicode code points.
 */
import { ApiError } from './api-error.js';
import { FIELD_COPY } from './errors.js';

export function codePoints(value: string): number {
  return [...value].length;
}


export function fieldCopy(field: string): string {
  switch (field) {
    case 'title':
      return FIELD_COPY.title;
    case 'frame_rate':
      return FIELD_COPY.frame_rate;
    case 'aspect_ratio':
      return FIELD_COPY.aspect_ratio;
    case 'body':
      return FIELD_COPY.body;
    case 'mentions':
      return FIELD_COPY.mentions;
    case 'text':
      return FIELD_COPY.text;
    case 'q':
      return FIELD_COPY.q;
    case 'limit':
      return FIELD_COPY.limit;
    case 'cursor':
      return FIELD_COPY.cursor;
    case 'file_name':
      return FIELD_COPY.file_name;
    case 'email':
      return FIELD_COPY.email;
    case 'expires_in_seconds':
      return FIELD_COPY.expires_in_seconds;
    default:
      return FIELD_COPY.other;
  }
}

export function invalid(field: string, copy?: string): ApiError {
  return ApiError.validation({ [field]: copy ?? fieldCopy(field) });
}


export function readString(
  source: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number; copy?: string } = {},
): string {
  const value = source[field];
  if (typeof value !== 'string') throw invalid(field, options.copy);
  const length = codePoints(value);
  if (length < (options.min ?? 1) || length > (options.max ?? Number.MAX_SAFE_INTEGER)) throw invalid(field, options.copy);
  return value;
}


export function readWhole(
  source: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number; copy?: string } = {},
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalid(field, options.copy);
  if (value < (options.min ?? Number.MIN_SAFE_INTEGER) || value > (options.max ?? Number.MAX_SAFE_INTEGER)) {
    throw invalid(field, options.copy);
  }
  return value;
}

export function readNumber(
  source: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(field);
  if (value < (options.min ?? -Infinity) || value > (options.max ?? Infinity)) throw invalid(field);
  return value;
}

export function readBoolean(source: Record<string, unknown>, field: string, fallback?: boolean): boolean {
  const value = source[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'boolean') throw invalid(field);
  return value;
}

export function readChoice<T extends string>(
  source: Record<string, unknown>,
  field: string,
  choices: readonly T[],
  copy?: string,
): T {
  const value = source[field];
  if (typeof value !== 'string' || !(choices as readonly string[]).includes(value)) throw invalid(field, copy);
  return value as T;
}

export function readStringArray(
  source: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number } = {},
): string[] {
  const value = source[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw invalid(field);
  if (value.length < (options.min ?? 0) || value.length > (options.max ?? Number.MAX_SAFE_INTEGER)) throw invalid(field);
  return value as string[];
}

export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** Cue text is 1 or 2 lines, each at most 42 code points, and not only whitespace. */
export const CAPTION_LINE_LIMIT = 42;
export const CAPTION_LINE_COUNT = 2;

export function captionTextIsValid(text: string): boolean {
  if (isBlank(text)) return false;
  const lines = text.split('\n');
  if (lines.length < 1 || lines.length > CAPTION_LINE_COUNT) return false;
  return lines.every((line) => codePoints(line) <= CAPTION_LINE_LIMIT);
}

export const NOTE_BODY_LIMIT = 2000;
export const MENTION_LIMIT = 5;

export function parseMentions(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/@([a-z0-9][a-z0-9_-]*)/gi)) found.add(match[1].toLowerCase());
  return [...found];
}

/** File names are 1 to 120 code points with no slashes, control characters or leading dot. */
export function fileNameIsValid(name: string): boolean {
  const length = codePoints(name);
  if (length < 1 || length > 120) return false;
  if (name.startsWith('.')) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  return ![...name].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

/** A folder is 1 to 80 code points of segments joined by " / ", none of them "." or "..". */
export function folderIsValid(folder: string): boolean {
  const length = codePoints(folder);
  if (length < 1 || length > 80) return false;
  const segments = folder.split(' / ');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(segment));
}

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
