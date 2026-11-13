import type { IncomingMessage, ServerResponse } from 'node:http';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export class ValidationError extends ApiError {
  constructor(fields: Record<string, string>) {
    super(422, 'invalid', { fields });
    this.name = 'ValidationError';
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const conflict = (code: string, extra?: Record<string, unknown>): ApiError =>
  new ApiError(409, code, extra);
export const storageUnavailableError = (): ApiError => new ApiError(503, 'storage_unavailable');
export const invalidField = (field: string, reason: string): ValidationError =>
  new ValidationError({ [field]: reason });

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: Buffer;
  accountId: string;
}

export function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, { error: error.code, ...error.extra });
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) throw new ApiError(413, 'too_large');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ValidationError({ body: 'invalid' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError({ body: 'invalid' });
  }
  return parsed as Record<string, unknown>;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw invalidField(field, 'invalid');
  return value;
}

export function requireInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalidField(field, 'invalid');
  }
  return value;
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalidField(field, 'invalid');
  return value;
}
