import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, invalid, notFound } from './errors.js';

export interface JsonBody {
  [key: string]: unknown;
}

export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface FieldSpec {
  type: FieldType;
  required: boolean;
}

export interface BodySpec {
  [key: string]: FieldSpec;
}

export type CheckedBody<T> = T;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeMatches(value: unknown, type: FieldType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
  }
}

/**
 * The one place every write body is checked against its published keys.
 * Any key not in the spec answers 422 with the published refusal message;
 * a published key with the wrong JSON type answers 422 on that key.
 */
export function checkBody(spec: BodySpec, body: JsonBody): ApiError | null {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!(key in spec)) {
      fields[key] = 'Lockset does not accept this field.';
    }
  }
  for (const [key, fieldSpec] of Object.entries(spec)) {
    const value = body[key];
    if (value === undefined) {
      if (fieldSpec.required) {
        fields[key] = 'This field is required.';
      }
      continue;
    }
    if (!typeMatches(value, fieldSpec.type)) {
      fields[key] = 'Lockset does not accept this value.';
    }
  }
  return Object.keys(fields).length > 0 ? invalid(fields) : null;
}

export function requireString(body: JsonBody, key: string): string {
  const value = body[key];
  if (typeof value === 'string') return value;
  return '';
}

export function requireNumber(body: JsonBody, key: string): number {
  const value = body[key];
  if (typeof value === 'number') return value;
  return NaN;
}

export function requireBoolean(body: JsonBody, key: string): boolean {
  return body[key] === true;
}

export function requireStringArray(body: JsonBody, key: string): string[] {
  const value = body[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

export async function readJsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number
): Promise<JsonBody | ApiError> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > maxBytes) {
      return new ApiError(413, 'too_large', 'That request is too large.');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return invalid({ body: 'Lockset does not accept this value.' });
    return parsed;
  } catch {
    return new ApiError(400, 'invalid_json', 'The request body could not be read.');
  }
}

export function jsonOk(res: ServerResponse, status: number, payload: unknown, headers?: Record<string, string>): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...(headers ?? {})
  });
  res.end(body);
}

export function emptyOk(res: ServerResponse, status: number, headers?: Record<string, string>): void {
  res.writeHead(status, headers);
  res.end();
}

export function unknownApiPath(): ApiError {
  return notFound();
}
