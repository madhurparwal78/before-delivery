// Reading loose JSON into typed values. Every failure is an `invalid` ApiError naming the offending field.
import * as copy from '../copy.ts';
import { fieldError } from '../errors.ts';

export type Json = Record<string, unknown>;

export function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRecord(value: unknown, field: string): Json {
  if (!isJson(value)) throw fieldError(field);
  return value;
}

export function readNumber(value: unknown, field: string, sentence: string = copy.NOT_A_NUMBER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw fieldError(field, sentence);
  return value;
}

export function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw fieldError(field);
  return value;
}

export function readBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw fieldError(field);
  return value;
}

export function readList(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw fieldError(field);
  return value;
}

export function readOneOf<T extends string | number>(value: unknown, field: string, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw fieldError(field);
  return found;
}

export function readPoint(value: unknown, field: string): [number, number] {
  const pair = readList(value, field);
  if (pair.length !== 2) throw fieldError(field);
  return [readNumber(pair[0], field), readNumber(pair[1], field)];
}

/** `undefined` when the field is absent, else read with `read`. */
export function optional<T>(json: Json, key: string, field: string, read: (value: unknown, field: string) => T): T | undefined {
  return json[key] === undefined ? undefined : read(json[key], field);
}
