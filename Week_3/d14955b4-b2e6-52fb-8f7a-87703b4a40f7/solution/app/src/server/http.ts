import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const notFound = (): HttpError => new HttpError(404, 'not_found', "That doesn't exist.");
export const unauthenticated = (): HttpError => new HttpError(401, 'unauthenticated', 'Sign in to continue.');
export const forbidden = (): HttpError => new HttpError(403, 'forbidden', "You can't do that.");
export const changeRefused = (): HttpError => new HttpError(403, 'change_refused', 'That change was refused.');
export const validation = (fields: Record<string, string>): HttpError => new HttpError(422, 'validation', 'Check the highlighted fields.', fields);

export interface Answer {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  raw?: Buffer | string;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  pathname: string;
  searchParams: URLSearchParams;
  params: Record<string, string>;
  nonce: string;
  rawBody: () => Promise<Buffer>;
  json: () => Promise<Record<string, unknown>>;
}

export const STREAMED: unique symbol = Symbol('streamed');

export interface Route {
  method: string;
  pattern: RegExp;
  names: string[];
  limit: number;
  lazyBody: boolean;
  kind: 'json' | 'multipart';
  handler: (ctx: Ctx) => Promise<Answer | typeof STREAMED>;
}

const JSON_LIMIT = 65_536;
export const UPLOAD_LIMIT = 5_000_000 + 65_536;

export function route(
  method: string,
  path: string,
  handler: Route['handler'],
  options: { limit?: number; lazyBody?: boolean; kind?: Route['kind'] } = {},
): Route {
  const names: string[] = [];
  const source = path.replace(/:([a-z]+)/g, (_match, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  return {
    method,
    pattern: new RegExp(`^${source}$`),
    names,
    limit: options.limit ?? JSON_LIMIT,
    lazyBody: options.lazyBody ?? false,
    kind: options.kind ?? 'json',
    handler,
  };
}

export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

export function cookies(req: IncomingMessage): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length, ...headers });
  res.end(payload);
}

export function errorBody(error: HttpError): { error: { code: string; message: string; fields?: Record<string, string> } } {
  return { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } };
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'too_large', 'That is too large.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'too_large', 'That is too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function hasBody(req: IncomingMessage): boolean {
  return Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
}

export function parseJsonObject(raw: Buffer): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw.toString('utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function contentSecurityPolicy(nonce: string, frameAncestors: string, sandbox = false): string {
  const parts = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    `frame-ancestors ${frameAncestors}`,
  ];
  if (sandbox) parts.push('sandbox');
  return parts.join('; ');
}

export function setSecurityHeaders(res: ServerResponse, nonce: string): void {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce, "'none'"));
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function startStream(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(': connected\n\n');
}
