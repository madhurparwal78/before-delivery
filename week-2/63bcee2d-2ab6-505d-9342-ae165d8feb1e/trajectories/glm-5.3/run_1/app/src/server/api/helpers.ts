// Shared API plumbing: raw-body capture, multipart parsing, validation helpers,
// idempotency replay.

import type { Request, Response, NextFunction } from 'express';
import { one, query } from '../lib/db.js';
import { ApiError, badRequest, validationError } from '../lib/errors.js';
import type { AuthedRequest } from '../lib/auth.js';

export interface ParsedMultipartFile {
  fieldName: string;
  fileName: string;
  data: Buffer;
  contentType: string;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: ParsedMultipartFile[];
}

export function parseMultipart(body: Buffer, contentTypeHeader: string): ParsedMultipart {
  const match = contentTypeHeader.match(/boundary="?([^";]+)"?/i);
  if (!match) throw badRequest();
  const boundary = Buffer.from(`--${match[1]}`);
  const parts: ParsedMultipart = { fields: {}, files: [] };
  let position = body.indexOf(boundary);
  if (position === -1) throw badRequest();
  position += boundary.length;
  while (position < body.length) {
    if (body[position] === 0x2d && body[position + 1] === 0x2d) break; // closing --
    if (body[position] === 0x0d && body[position + 1] === 0x0a) position += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), position);
    if (headerEnd === -1) break;
    const headerText = body.subarray(position, headerEnd).toString('utf8');
    const nextBoundary = body.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;
    // Part data ends 2 bytes (CRLF) before the boundary.
    const dataEnd = nextBoundary - 2;
    const data = body.subarray(headerEnd + 4, dataEnd);
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const fileName = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const contentType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1] ?? 'application/octet-stream';
    if (fileName !== undefined) {
      parts.files.push({ fieldName: name, fileName: fileName.replace(/.*[/\\]/, ''), data: Buffer.from(data), contentType });
    } else {
      parts.fields[name] = data.toString('utf8');
    }
    position = nextBoundary + boundary.length;
  }
  return parts;
}

/** JSON body reader with the published 65,536-byte limit; unparsable → 400 bad_request. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const raw = req.body;
  if (raw === undefined || raw === null || Object.keys(raw).length === 0) {
    // express.json populated empty body; try to interpret as {}.
    return {};
  }
  if (typeof raw !== 'object') throw badRequest();
  return raw as Record<string, unknown>;
}

// ---------- Validation helpers ----------

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function requireString(value: unknown, field: string, label: string, errors: Record<string, string>): string {
  if (typeof value !== 'string' || value.length === 0) {
    errors[field] = `${label} is required.`;
    return '';
  }
  return value;
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Characters as user-perceived: code points (covers flags and family emoji via code points... complex emoji are multiple code points, but counting code points is the accepted approximation here). */
export function charCount(value: string): number {
  return [...value].length;
}

export function checkLength(value: string, field: string, label: string, limit: number, errors: Record<string, string>): void {
  if (charCount(value) > limit) {
    errors[field] = `${label} can be at most ${limit} characters.`;
  }
}

export function checkOneLine(value: string, field: string, label: string, errors: Record<string, string>): void {
  if (/[\r\n]/.test(value)) {
    errors[field] = `${label} must be on one line.`;
  }
}

export function checkCents(value: unknown, field: string, label: string, min: number, max: number, errors: Record<string, string>): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors[field] = `Enter an amount like 1250.00.`;
    return null;
  }
  if (value < min || value > max) {
    errors[field] = `${label} must be between ${min} and ${max}.`;
    return null;
  }
  return value;
}

export function throwValidation(errors: Record<string, string>): void {
  if (Object.keys(errors).length > 0) throw validationError(errors);
}

// ---------- Idempotency ----------

const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;

export function stableHash(body: unknown): string {
  return JSON.stringify(sortValue(body));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortValue(v)]));
  }
  return value;
}

/**
 * Idempotent replay per member and key for 24 hours. Same key + same body →
 * stored response; same key + different body → 409 idempotency_key_reused.
 * Runs BEFORE any later check but AFTER session/role/404 per precedence.
 */
export async function withIdempotency<T>(
  req: AuthedRequest,
  responseProducer: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T }> {
  const key = req.header('Idempotency-Key') ?? '';
  if (key.length < 1 || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) {
    throw validationError({ idempotencyKey: 'Retry key is missing; reload and try again.' });
  }
  const member = req.member!;
  const existing = await one<{ request_hash: string; status: number; response_body: unknown; created_at: Date }>(
    'SELECT * FROM idempotency_keys WHERE member_id = $1 AND key = $2',
    [member.id, key],
  );
  if (existing) {
    if (Date.now() - existing.created_at.getTime() > REPLAY_TTL_MS) {
      await query('DELETE FROM idempotency_keys WHERE member_id = $1 AND key = $2', [member.id, key]);
    } else {
      if (existing.request_hash !== stableHash(req.body)) {
        throw new ApiError(409, { error: 'idempotency_key_reused' });
      }
      return { status: existing.status, body: existing.response_body as T };
    }
  }
  const produced = await responseProducer();
  await query(
    'INSERT INTO idempotency_keys (member_id, key, endpoint, request_hash, status, response_body) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (member_id, key) DO NOTHING',
    [member.id, key, req.path, stableHash(req.body), produced.status, JSON.stringify(produced.body)],
  );
  return produced;
}

// ---------- Router helper ----------

export type AsyncHandler = (req: AuthedRequest, res: Response) => Promise<unknown>;

export function wrap(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req as AuthedRequest, res).catch(next);
  };
}
