/** The one place where a write body is checked against the keys its endpoint publishes. */

import { copy } from './copy.js';
import { ApiError, invalid, type ErrorFields } from './errors.js';

export type FieldKind = 'string' | 'boolean' | 'integer' | 'string_array' | 'true';

export type FieldSpec =
  | { kind: FieldKind; optional?: boolean }
  | { kind: 'object'; optional?: boolean; nullable?: boolean; shape: Record<string, FieldSpec> };

export type BodySpec = Record<string, FieldSpec>;

const KIND_MESSAGE: Record<FieldKind | 'object', string> = {
  string: 'This must be text.',
  boolean: 'This must be true or false.',
  integer: 'This must be a whole number.',
  string_array: 'This must be a list of names.',
  true: 'This must be confirmed.',
  object: 'This must be a group of fields.',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeMatches(spec: FieldSpec, value: unknown): boolean {
  switch (spec.kind) {
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'true':
      return value === true;
    case 'string_array':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
    case 'object':
      return isPlainObject(value) || (spec.nullable === true && value === null);
  }
}

/**
 * Reads a write body. Unknown keys are refused first, then missing or wrongly
 * typed published keys. Nothing is read unless the whole body passes.
 */
export function readBody(raw: unknown, spec: BodySpec): Record<string, unknown> {
  if (!isPlainObject(raw)) throw new ApiError(422, 'invalid', 'Check the highlighted fields.', { fields: {} });

  const unknown: ErrorFields = {};
  for (const key of Object.keys(raw)) {
    if (!(key in spec)) unknown[key] = copy.unknownField;
  }
  if (Object.keys(unknown).length > 0) throw invalid(unknown);

  const wrong: ErrorFields = {};
  for (const [key, fieldSpec] of Object.entries(spec)) {
    const present = key in raw;
    if (!present) {
      if (fieldSpec.optional !== true) wrong[key] = 'This field is required.';
      continue;
    }
    const value = raw[key];
    if (!typeMatches(fieldSpec, value)) {
      wrong[key] = KIND_MESSAGE[fieldSpec.kind];
      continue;
    }
    if (fieldSpec.kind === 'object' && isPlainObject(value)) {
      for (const nested of Object.keys(value)) {
        if (!(nested in fieldSpec.shape)) wrong[key] = copy.unknownField;
      }
      for (const [nested, nestedSpec] of Object.entries(fieldSpec.shape)) {
        if (!(nested in value)) {
          if (nestedSpec.optional !== true) wrong[key] = 'This field is required.';
        } else if (!typeMatches(nestedSpec, value[nested])) {
          wrong[key] = KIND_MESSAGE[nestedSpec.kind];
        }
      }
    }
  }
  if (Object.keys(wrong).length > 0) throw invalid(wrong);
  return raw;
}

export function text(body: Record<string, unknown>, key: string): string {
  return body[key] as string;
}

export function optionalText(body: Record<string, unknown>, key: string): string | undefined {
  return key in body ? (body[key] as string) : undefined;
}

export function flag(body: Record<string, unknown>, key: string): boolean {
  return body[key] as boolean;
}

export function optionalFlag(body: Record<string, unknown>, key: string): boolean | undefined {
  return key in body ? (body[key] as boolean) : undefined;
}

export function whole(body: Record<string, unknown>, key: string): number {
  return body[key] as number;
}

export function optionalWhole(body: Record<string, unknown>, key: string): number | undefined {
  return key in body ? (body[key] as number) : undefined;
}

export function textList(body: Record<string, unknown>, key: string): string[] {
  return body[key] as string[];
}

export function optionalTextList(body: Record<string, unknown>, key: string): string[] | undefined {
  return key in body ? (body[key] as string[]) : undefined;
}

export function group(body: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = body[key];
  return value === null || value === undefined ? null : (value as Record<string, unknown>);
}
