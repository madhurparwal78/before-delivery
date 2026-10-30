import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';

export const MAX_BODY_BYTES = 16_384;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  setCookie?: string;
}

export interface RequestContext {
  readonly method: string;
  readonly path: string;
  readonly url: URL;
  readonly body: Record<string, unknown> | undefined;
  header(name: string): string | undefined;
  cookie(name: string): string | undefined;
}

export const noContent: Reply = { status: 204 };

export function json(status: number, body: unknown, headers?: Record<string, string>): Reply {
  return { status, body, headers };
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function hasBody(req: IncomingMessage): boolean {
  const length = headerValue(req, 'content-length');
  if (length !== undefined && Number(length) > 0) return true;
  return headerValue(req, 'transfer-encoding') !== undefined;
}

/** Refuses writes whose Origin is not the origin the request was addressed to. */
function checkOrigin(req: IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = headerValue(req, 'origin');
  if (!origin || origin === 'null') return;
  const host = headerValue(req, 'host') ?? '';
  const scheme = headerValue(req, 'x-forwarded-proto') ?? 'http';
  if (origin !== `${scheme}://${host}`) throw new ApiError('cross_origin');
}

function checkMediaType(req: IncomingMessage): void {
  const type = (headerValue(req, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError('unsupported_media_type');
}

function readBytes(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError('too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return jar;
}

/**
 * Builds the request context, answering the boundary failures in their published order:
 * cross-origin, media type, size, then malformed JSON.
 */
export async function readRequest(req: IncomingMessage, url: URL): Promise<RequestContext> {
  checkOrigin(req);
  let body: Record<string, unknown> | undefined;
  if (hasBody(req)) {
    checkMediaType(req);
    const declared = headerValue(req, 'content-length');
    if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) throw new ApiError('too_large');
    const bytes = await readBytes(req);
    if (bytes.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        throw new ApiError('invalid_json');
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ApiError('invalid_json');
      body = parsed as Record<string, unknown>;
    }
  }
  const jar = parseCookies(headerValue(req, 'cookie'));
  return {
    method: req.method ?? 'GET',
    path: url.pathname,
    url,
    body,
    header: (name) => headerValue(req, name.toLowerCase()),
    cookie: (name) => jar.get(name),
  };
}

export function sendJson(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...reply.headers,
  };
  if (reply.setCookie !== undefined) headers['set-cookie'] = reply.setCookie;
  if (reply.body === undefined) {
    delete headers['content-type'];
    res.writeHead(reply.status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
  headers['content-length'] = String(payload.length);
  res.writeHead(reply.status, headers);
  res.end(payload);
}
