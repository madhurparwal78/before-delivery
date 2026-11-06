import type { IncomingMessage, ServerResponse } from 'node:http';
import { invalidJson, payloadTooLarge, unsupportedMediaType } from './errors';

export const DEFAULT_BODY_LIMIT = 65_536;
export const INGESTION_BODY_LIMIT = 2_000_000;

export interface RequestContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly params: Record<string, string>;
  readonly body: unknown;
  readonly cookies: Record<string, string>;
}

/** Fields are read from an object body; any other JSON value behaves as an empty body. */
export function bodyField(body: unknown, name: string): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return (body as Record<string, unknown>)[name];
}

function mediaType(header: string | undefined): string | null {
  if (header === undefined) return null;
  const value = header.split(';')[0]?.trim().toLowerCase();
  return value === undefined || value === '' ? null : value;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

async function readRaw(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        request.destroy();
        reject(payloadTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 * Reads the request body under its limit. The media type is decided by the Content-Type
 * header alone, before the body is read; an empty body is treated as `{}`.
 */
export async function readBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const declaredLength = request.headers['content-length'];
  const type = mediaType(request.headers['content-type']);
  if (declaredLength !== undefined) {
    const length = Number(declaredLength);
    if (Number.isFinite(length)) {
      if (length === 0) return {};
      if (type !== 'application/json') throw unsupportedMediaType();
      if (length > limit) throw payloadTooLarge();
    }
  }
  const raw = await readRaw(request, limit);
  if (raw.length === 0) return {};
  if (type !== 'application/json') throw unsupportedMediaType();
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw invalidJson();
  }
}

export function sendJson(
  context: RequestContext,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  context.response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  context.response.end(payload);
}

/** Sends an already serialised body, so an idempotent replay is byte for byte. */
export function sendRawJson(
  context: RequestContext,
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(`${bodyText}\n`, 'utf8');
  context.response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  context.response.end(payload);
}

export function sendNoContent(
  context: RequestContext,
  headers: Record<string, string> = {},
): void {
  context.response.writeHead(204, { 'cache-control': 'no-store', ...headers });
  context.response.end();
}
