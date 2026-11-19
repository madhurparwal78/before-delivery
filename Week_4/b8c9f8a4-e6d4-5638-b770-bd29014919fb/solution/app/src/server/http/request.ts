// Reading a request: size limits, content types and the origin guard, in the published order.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail } from './errors.js';

const JSON_LIMIT = 65536;
const CAPTURE_LIMIT = 262144;
const UPLOAD_LIMIT = 8200000;

export interface Context {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  readonly params: Record<string, string>;
  /** Read before anything else, so an oversized body is refused before any other check. */
  readonly body: Buffer;
}

/** The published limit for this route, and the refusal an oversized body earns. */
export function limitFor(path: string): { limit: number; refuse: () => never } {
  if (path.endsWith('/uploads')) {
    return { limit: UPLOAD_LIMIT, refuse: () => fail(413, 'file_too_large', 'That file is over the size limit.') };
  }
  const limit = path.endsWith('/capture') ? CAPTURE_LIMIT : JSON_LIMIT;
  return { limit, refuse: () => fail(413, 'body_too_large', 'That request body is too large.') };
}

export function cookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  const found: Record<string, string> = {};
  if (!header) return found;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    found[part.slice(0, at).trim()] = decodeURIComponent(part.slice(at + 1).trim());
  }
  return found;
}

/** A state-changing request may only come from this origin. */
export function guardOrigin(request: IncomingMessage): void {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host ?? '';
  let sent: URL;
  try {
    sent = new URL(origin);
  } catch {
    fail(403, 'cross_origin', 'That request came from another origin.');
  }
  if (sent.host !== host) fail(403, 'cross_origin', 'That request came from another origin.');
}

export async function readBody(request: IncomingMessage, limit: number, tooLarge: () => never): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    tooLarge();
  }
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = chunk as Buffer;
    size += part.length;
    if (size > limit) {
      request.destroy();
      tooLarge();
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function isJsonType(request: IncomingMessage): boolean {
  const header = String(request.headers['content-type'] ?? '');
  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}

/** A JSON body, refused in the published order: too large, then wrong type, then malformed. */
export function readJson(context: Context): unknown {
  // A request with no body has no content type to be wrong (brief: 415 is for a wrong content type).
  if (context.body.length === 0 && !context.request.headers['content-type']) return {};
  if (!isJsonType(context.request)) fail(415, 'unsupported_media_type', 'Send this as application/json.');
  if (context.body.length === 0) return {};
  try {
    return JSON.parse(context.body.toString('utf8')) as unknown;
  } catch {
    fail(422, 'validation', 'That body is not valid JSON.', { errors: { body: 'Send valid JSON.' } });
  }
}

export function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
