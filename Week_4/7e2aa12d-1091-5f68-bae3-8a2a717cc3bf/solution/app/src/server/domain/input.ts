import { INVALID_BODY_MESSAGE } from '../../shared/messages.js';
import { Refusal } from './refusal.js';

export type Json = Record<string, unknown>;

/** Reading request fields: a field of the wrong type is the published invalid-body refusal. */
export const invalid = (): Refusal => new Refusal(INVALID_BODY_MESSAGE);

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

export function record(value: unknown): Json {
  if (!isRecord(value)) throw invalid();
  return value;
}

export function text(source: Json, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') throw invalid();
  return value;
}

export function number(source: Json, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
  return value;
}

export function integer(source: Json, key: string): number {
  const value = number(source, key);
  if (!Number.isInteger(value)) throw invalid();
  return value;
}

export function list(source: Json, key: string): unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) throw invalid();
  return value;
}

/** Throws the refusal when a rule's check answered with a message. */
export function refuse(message: string | null): void {
  if (message) throw new Refusal(message);
}

/** A trimmed name field, checked by its rule (`layoutName` or `versionName`). */
export function nameField(source: Json, key: string, rule: (value: string) => { name: string } | { message: string }): string {
  const result = rule(text(source, key));
  if ('message' in result) throw new Refusal(result.message);
  return result.name;
}
