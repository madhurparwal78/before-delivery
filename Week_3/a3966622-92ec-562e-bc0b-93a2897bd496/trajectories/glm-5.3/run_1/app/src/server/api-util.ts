// API plumbing: the one published error shape, request limits, JSON body
// handling and the idempotency rule.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Store } from './store.js';
import type { IdempotencyRecord, User } from './types.js';

export const MAX_JSON_BYTES = 65_536;

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public override readonly message: string;
  public readonly errors?: Record<string, string>;
  public readonly extra?: Record<string, unknown>;
  constructor(
    status: number,
    code: string,
    message: string,
    errors?: Record<string, string>,
    extra?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.message = message;
    if (errors !== undefined) this.errors = errors;
    if (extra !== undefined) this.extra = extra;
  }
}

export function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.errors) body.errors = err.errors;
  if (err.extra) Object.assign(body, err.extra);
  return body;
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Not found');
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in required');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'Not permitted');
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  user: User | null;
  body: unknown;
  rawBody: Buffer;
  store: Store;
  idempotencyKey: string | null;
}

// Reads a body up to the published limit. Returns null when no body is present.
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > maxBytes) {
    throw new ApiError(413, 'payload_too_large', 'Payload too large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new ApiError(413, 'payload_too_large', 'Payload too large');
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;
  return Buffer.concat(chunks);
}

export function jsonOrThrow(raw: Buffer | null): unknown {
  if (raw === null || raw.length === 0) {
    throw new ApiError(422, 'validation_failed', 'Body required', {});
  }
  try {
    return JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    throw new ApiError(422, 'validation_failed', 'Body must be JSON', {});
  }
}

export async function readJsonBody(req: IncomingMessage, raw: Buffer | null): Promise<unknown> {
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType !== '' && !contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Unsupported content type');
  }
  return jsonOrThrow(raw);
}

export function requireUser(ctx: { user: User | null }): User {
  if (!ctx.user) throw unauthenticated();
  return ctx.user;
}

export function requireRole(user: User, roles: User['role'][]): void {
  if (!roles.includes(user.role)) throw forbidden();
}

// The fingerprint of a keyed request's body: JSON with key order and
// whitespace ignored.
export function fingerprint(body: unknown): string {
  return JSON.stringify(sortKeys(body));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeys(v);
    return out;
  }
  return value;
}

export interface IdempotencyOutcome {
  replay?: { status: number; body: string };
  inProgress?: IdempotencyRecord;
  fresh: boolean;
}

// The keyed-request rule: same key and body returns the stored response,
// a key reused with a different body is refused, and a request that arrives
// while the first is still in progress waits for it.
export async function beginKeyed(
  store: Store,
  user: User,
  method: string,
  path: string,
  key: string | null,
  body: unknown,
): Promise<IdempotencyOutcome> {
  if (!key) return { fresh: true };
  const fp = fingerprint(body);
  const existing = store.idempotency.find(
    (r) => r.user_id === user.id && r.key === key,
  );
  if (existing) {
    if (existing.method !== method || existing.path !== path || existing.body_fingerprint !== fp) {
      throw new ApiError(409, 'idempotency_conflict', 'Key reused with a different request');
    }
    if (existing.state === 'finished') {
      return { fresh: false, replay: { status: existing.status, body: existing.body } };
    }
    // Wait for the in-progress request.
    for (let i = 0; i < 600; i++) {
      await sleep(100);
      const again = store.idempotency.find((r) => r.user_id === user.id && r.key === key);
      if (!again) break;
      if (again.state === 'finished') {
        return { fresh: false, replay: { status: again.status, body: again.body } };
      }
    }
    return { fresh: true };
  }
  store.idempotency.push({
    user_id: user.id,
    key,
    method,
    path,
    body_fingerprint: fp,
    status: 0,
    body: '',
    state: 'in_progress',
    at_ms: Date.now(),
  });
  await store.save();
  return { fresh: true };
}

// Stores the reply for a keyed request. A 202 or 5xx reply is not kept once
// its request finishes, so a later request with that key runs again.
export async function finishKeyed(
  store: Store,
  user: User,
  method: string,
  path: string,
  key: string | null,
  body: unknown,
  status: number,
  responseBody: string,
): Promise<void> {
  if (!key) return;
  if (status === 202 || status >= 500) {
    const record = store.idempotency.find(
      (r) => r.user_id === user.id && r.key === key && r.state === 'in_progress',
    );
    if (record) {
      store.idempotency.splice(store.idempotency.indexOf(record), 1);
      await store.save();
    }
    return;
  }
  const record = store.idempotency.find((r) => r.user_id === user.id && r.key === key);
  if (!record) return;
  record.status = status;
  record.body = responseBody;
  record.state = 'finished';
  record.at_ms = Date.now();
  record.body_fingerprint = fingerprint(body);
  record.method = method;
  record.path = path;
  await store.save();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
