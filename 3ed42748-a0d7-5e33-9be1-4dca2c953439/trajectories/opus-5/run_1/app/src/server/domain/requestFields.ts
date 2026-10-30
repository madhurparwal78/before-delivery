import { type FieldReasons, validation } from '../http/errors.js';

/** A leaf accepts any JSON value; a nested spec also publishes the keys inside an object. */
export type FieldSpec = true | { [key: string]: FieldSpec };

const MAX_DEPTH = 32;

export type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tooDeep(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => tooDeep(item, depth + 1));
  if (isPlainObject(value)) return Object.values(value).some((item) => tooDeep(item, depth + 1));
  return false;
}

function collectUnknown(value: JsonObject, spec: FieldSpec, path: string, found: FieldReasons): void {
  if (spec === true) return;
  for (const key of Object.keys(value)) {
    const dotted = path === '' ? key : `${path}.${key}`;
    const inner = spec[key];
    if (inner === undefined) {
      found[dotted] = 'unknown_field';
      continue;
    }
    const child = value[key];
    if (inner !== true && isPlainObject(child)) {
      collectUnknown(child, inner, dotted, found);
    }
  }
}

/**
 * Checks a parsed JSON body against the keys its endpoint publishes. The body shape is judged
 * first, then unknown keys anywhere in it; published-field problems are left to the caller.
 */
export function readPublishedBody(body: unknown, spec: FieldSpec): JsonObject {
  if (!isPlainObject(body) || tooDeep(body, 1)) {
    throw validation({ body: 'invalid' });
  }
  const unknown: FieldReasons = {};
  collectUnknown(body, spec, '', unknown);
  if (Object.keys(unknown).length > 0) throw validation(unknown);
  return body;
}

export function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface Position {
  lat: number;
  lon: number;
}

export interface PresencePosition extends Position {
  heading_deg: number;
}

interface Bound {
  min: number;
  max: number;
  maxExclusive?: boolean;
}

const positionBounds: Record<string, Bound> = {
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
  heading_deg: { min: 0, max: 360, maxExclusive: true },
};

function readCoordinates(raw: unknown, keys: string[], field: string, into: FieldReasons): void {
  if (raw === undefined) {
    into[field] = 'required';
    return;
  }
  if (!isPlainObject(raw)) {
    into[field] = 'invalid';
    return;
  }
  for (const key of keys) {
    const path = `${field}.${key}`;
    const value = raw[key];
    if (value === undefined) {
      into[path] = 'required';
      continue;
    }
    if (!isFiniteNumber(value)) {
      into[path] = 'invalid';
      continue;
    }
    const bound = positionBounds[key]!;
    const over = bound.maxExclusive ? value >= bound.max : value > bound.max;
    if (value < bound.min || over) into[path] = 'out_of_range';
  }
}

/** The `{"lat","lon"}` position an accept, claim or hand-over carries. */
export function readPosition(body: JsonObject, field = 'position'): Position {
  const reasons: FieldReasons = {};
  readCoordinates(body[field], ['lat', 'lon'], field, reasons);
  if (Object.keys(reasons).length > 0) throw validation(reasons);
  const raw = body[field] as JsonObject;
  return { lat: raw.lat as number, lon: raw.lon as number };
}

/** The `{"lat","lon","heading_deg"}` position a presence heartbeat carries. */
export function readPresencePosition(raw: unknown, into: FieldReasons): PresencePosition | null {
  readCoordinates(raw, ['lat', 'lon', 'heading_deg'], 'position', into);
  if (Object.keys(into).some((key) => key === 'position' || key.startsWith('position.'))) {
    return null;
  }
  const value = raw as JsonObject;
  return {
    lat: value.lat as number,
    lon: value.lon as number,
    heading_deg: value.heading_deg as number,
  };
}

export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;
