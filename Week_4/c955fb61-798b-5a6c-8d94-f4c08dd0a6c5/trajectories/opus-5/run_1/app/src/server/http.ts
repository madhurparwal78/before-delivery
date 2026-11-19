import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 100_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error));
  }
}

export const errors = {
  tooLarge: (): ApiError => new ApiError(413, { error: 'too_large' }),
  unsupportedMediaType: (): ApiError => new ApiError(415, { error: 'unsupported_media_type' }),
  badOrigin: (): ApiError => new ApiError(403, { error: 'bad_origin' }),
  unauthenticated: (): ApiError => new ApiError(401, { error: 'unauthenticated' }),
  notFound: (): ApiError => new ApiError(404, { error: 'not_found' }),
  readOnly: (): ApiError => new ApiError(403, { error: 'read_only' }),
  invalidField: (field: string): ApiError => new ApiError(422, { error: 'invalid_field', field }),
  serverError: (): ApiError => new ApiError(500, { error: 'server_error' }),
};

export interface RawBody {
  /** Null when the request carried no body at all. */
  text: string | null;
  contentType: string | null;
}

export function readBody(req: IncomingMessage): Promise<RawBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        chunks.length = 0;
        reject(errors.tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      const text = chunks.length === 0 ? null : Buffer.concat(chunks).toString('utf8');
      resolve({ text, contentType: req.headers['content-type'] ?? null });
    });
    req.on('error', (error) => {
      if (!failed) reject(error);
    });
  });
}

export function parseJsonBody(raw: RawBody): Record<string, unknown> {
  const type = (raw.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw errors.unsupportedMediaType();
  if (raw.text === null || raw.text.trim() === '') throw errors.unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    throw errors.unsupportedMediaType();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw errors.unsupportedMediaType();
  }
  return parsed as Record<string, unknown>;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
}

export function sendText(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string>,
): void {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, { ...headers, 'content-length': buffer.length });
  res.end(buffer);
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    result.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return result;
}

export function isStateChanging(method: string): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
}

export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
