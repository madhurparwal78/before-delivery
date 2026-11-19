import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';
import { ApiError, crossOrigin, payloadTooLarge, unsupportedMediaType } from './errors.js';
import { parseJson } from './json.js';

export const MAX_BODY_BYTES = 1_000_000;

export type RequestContext = {
  method: string;
  path: string;
  query: URLSearchParams;
  rawQuery: string;
  bodyText: string;
  body: unknown;
  headers: IncomingMessage['headers'];
  cookies: Record<string, string>;
  idempotencyKey: string | null;
};

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') out[name] = decodeURIComponent(value);
  }
  return out;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The server boundary checks, in the published order. */
export async function readRequest(request: IncomingMessage): Promise<RequestContext> {
  const raw = await readBody(request);
  const contentType = request.headers['content-type'];
  if (raw.length > 0 || contentType !== undefined) {
    const mediaType = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
    if (mediaType !== 'application/json') throw unsupportedMediaType();
  }

  const method = (request.method ?? 'GET').toUpperCase();
  if (STATE_CHANGING.has(method)) {
    const origin = request.headers['origin'];
    const host = request.headers['host'] ?? '';
    const allowed = new Set([originOf(`http://${host}`), originOf(config.publicUrl)]);
    if (typeof origin === 'string') {
      if (origin === 'null' || !allowed.has(originOf(origin))) throw crossOrigin();
    } else {
      const site = request.headers['sec-fetch-site'];
      if (site === 'cross-site' || site === 'same-site') throw crossOrigin();
    }
  }

  const url = new URL(request.url ?? '/', 'http://internal');
  const bodyText = raw.toString('utf8');
  let body: unknown = undefined;
  if (bodyText.trim() !== '') {
    try {
      body = parseJson(bodyText);
    } catch {
      throw new ApiError(422, 'invalid', 'Send a JSON body.', { fields: { body: 'Send JSON.' } });
    }
  }
  const idempotencyHeader = request.headers['idempotency-key'];

  return {
    method,
    path: url.pathname,
    query: url.searchParams,
    rawQuery: url.search,
    bodyText,
    body,
    headers: request.headers,
    cookies: parseCookies(request.headers['cookie']),
    idempotencyKey: typeof idempotencyHeader === 'string' ? idempotencyHeader : null,
  };
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    ...headers,
  });
  response.end(text);
}

export function sendText(
  response: ServerResponse,
  status: number,
  body: Buffer | string,
  headers: Record<string, string>,
): void {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': buffer.length,
    ...headers,
  });
  response.end(buffer);
}

export function sessionCookie(token: string): string {
  return `tf_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return 'tf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
