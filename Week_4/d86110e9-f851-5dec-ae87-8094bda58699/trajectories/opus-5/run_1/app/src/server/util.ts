import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { MAX_JSON_DEPTH } from './config';
import type { JsonObject, JsonValue } from '../shared/types';

export function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

export function newId(prefix: string): string {
  return `${prefix}-${hex(4)}`;
}

export function token(): string {
  return randomBytes(24).toString('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Characters as a person sees them, so an emoji counts as one. */
export function visibleLength(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base === '' ? 'workspace' : base;
}

export function isPath(value: string): boolean {
  return /^[a-z0-9-]+$/.test(value);
}

export function jsonDepth(value: JsonValue, depth = 1): number {
  if (Array.isArray(value)) {
    let deepest = depth;
    for (const item of value) deepest = Math.max(deepest, jsonDepth(item, depth + 1));
    return deepest;
  }
  if (value !== null && typeof value === 'object') {
    let deepest = depth;
    for (const item of Object.values(value)) deepest = Math.max(deepest, jsonDepth(item, depth + 1));
    return deepest;
  }
  return depth;
}

export function tooDeep(value: JsonValue): boolean {
  return jsonDepth(value) > MAX_JSON_DEPTH;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function emailLooksValid(value: unknown): boolean {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** A finite decimal number written as text, with an optional sign and fraction. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
