// Request body validation: unknown members at any depth, the published number grammar,
// and field copy at RFC 6901 pointers (DP-11, DP-52).

import { FIELD_COPY } from '../shared/copy.js';
import { parseNumberGrammar } from '../shared/grammar.js';
import { metresFromQuantity, parseQuantityDecimal, type Quantity } from '../shared/quantities.js';
import { problems, type Problem } from '../shared/problems.js';
import type { Decimal } from '../shared/decimal.js';

export type JsonObject = { [key: string]: unknown };
export type FieldErrors = { [pointer: string]: string };

export function readJsonObject(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as JsonObject;
}

// Bodies refuse any member not listed, at any depth, including __proto__ and constructor.
export function findUnknownMembers(value: unknown, allowed: readonly string[], prefix = ''): string | null {
  const object = readJsonObject(value);
  if (object === null) return null;
  const seen = new Set<string>();
  for (const key of Object.keys(object)) {
    if (seen.has(key)) return `${prefix}${key}`;
    seen.add(key);
    if (!allowed.includes(key)) {
      return `${prefix}${key}`;
    }
  }
  if (Object.prototype.hasOwnProperty.call(object, '__proto__')) return `${prefix}__proto__`;
  return null;
}

export function deepUnknownMembers(value: unknown, allowedByDepth: (path: string) => readonly string[] | null, prefix = ''): string | null {
  const object = readJsonObject(value);
  if (object === null) return null;
  const allowed = allowedByDepth(prefix);
  if (allowed === null) return null;
  const unknown = findUnknownMembers(object, allowed);
  if (unknown !== null) return unknown;
  for (const [key, child] of Object.entries(object)) {
    const childPath = prefix === '' ? key : `${prefix}${key}`;
    const childAllowed = allowedByDepth(childPath);
    if (childAllowed === null) continue;
    if (readJsonObject(child) !== null) {
      const nested = deepUnknownMembers(child, allowedByDepth, childPath);
      if (nested !== null) return nested === '' ? key : nested;
    }
  }
  return null;
}

export interface QuantityCheck {
  ok: boolean;
  decimal: Decimal | null;
  error: string | null;
}

// A Quantity is {"text","unit"}; a bare JSON number in its place is the bad-number copy
// at the Quantity's own pointer.
export function checkQuantity(value: unknown, allowNegative: boolean, units: readonly string[], unitError: string): QuantityCheck {
  if (typeof value === 'number') {
    return { ok: false, decimal: null, error: FIELD_COPY.badNumber };
  }
  const object = readJsonObject(value);
  if (object === null) {
    return { ok: false, decimal: null, error: FIELD_COPY.required };
  }
  const text = object.text;
  const unit = object.unit;
  if (typeof text !== 'string') {
    return { ok: false, decimal: null, error: FIELD_COPY.badNumber };
  }
  if (typeof unit !== 'string') {
    return { ok: false, decimal: null, error: unitError };
  }
  const grammar = parseNumberGrammar(text, allowNegative);
  if (!grammar.ok) {
    return { ok: false, decimal: null, error: grammar.fieldCopy === 'thousands' ? FIELD_COPY.thousands : FIELD_COPY.badNumber };
  }
  if (!units.includes(unit)) {
    return { ok: false, decimal: null, error: unitError };
  }
  const decimal = parseQuantityDecimal(text, allowNegative);
  if (decimal === null) {
    return { ok: false, decimal: null, error: FIELD_COPY.badNumber };
  }
  return { ok: true, decimal, error: null };
}

export function quantityMetres(value: Quantity): Decimal | null {
  return metresFromQuantity(value);
}

export function validationProblem(errors: FieldErrors): Problem {
  return problems.validationFailed(errors);
}

export function unknownFieldProblem(field: string): Problem {
  return problems.unknownField(field);
}
