import { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, fail } from './errors';

export const JSON_BODY_LIMIT = 65_536;
export const EXHIBIT_BODY_LIMIT = 10_000_000;

export interface RequestContext {
  method: string;
  path: string;
  searchParams: URLSearchParams;
  headers: IncomingMessage['headers'];
  params: Record<string, string>;
  request: IncomingMessage;
}

export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  bytes?: Buffer;
  text?: string;
}

export function jsonResponse(status: number, json: unknown, headers?: Record<string, string>): ApiResponse {
  return headers ? { status, json, headers } : { status, json };
}

export function headerOf(context: RequestContext, name: string): string | undefined {
  const value = context.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function isJsonContentType(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'application/json';
}

/**
 * Reads the body up to `limit`. An oversize body is drained rather than cut
 * off, so the client reliably receives the size refusal instead of a reset
 * connection; a body far past the limit has its connection dropped.
 */
function readBody(context: RequestContext, limit: number): Promise<Buffer> {
  const hardLimit = limit * 4;
  return new Promise<Buffer>((resolve, reject) => {
    const request = context.request;
    const chunks: Buffer[] = [];
    let total = 0;
    let oversize = false;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        oversize = true;
        chunks.length = 0;
        if (total > hardLimit) {
          request.destroy();
          reject(fail('payload_too_large'));
        }
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (oversize) reject(fail('payload_too_large'));
      else resolve(Buffer.concat(chunks));
    });
    request.once('error', () => reject(fail('payload_too_large')));
  });
}

/** Reads a JSON body: size limit, then content type, then parsing. */
export async function readJsonBody(context: RequestContext): Promise<Record<string, unknown>> {
  const contentType = headerOf(context, 'content-type');
  if (contentType !== undefined && !isJsonContentType(contentType)) {
    throw fail('unsupported_media_type');
  }
  const raw = await readBody(context, JSON_BODY_LIMIT);
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw fail('invalid_json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail('invalid_json');
  }
  return parsed as Record<string, unknown>;
}

export async function readRawJsonBody(context: RequestContext): Promise<Buffer> {
  const contentType = headerOf(context, 'content-type');
  if (contentType !== undefined && !isJsonContentType(contentType)) {
    throw fail('unsupported_media_type');
  }
  return readBody(context, JSON_BODY_LIMIT);
}

export async function readPdfBody(context: RequestContext): Promise<Buffer> {
  const contentType = headerOf(context, 'content-type');
  const base = contentType?.split(';')[0]?.trim().toLowerCase();
  if (base !== 'application/pdf') throw fail('unsupported_media_type');
  return readBody(context, EXHIBIT_BODY_LIMIT);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name.length > 0) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function writeResponse(response: ServerResponse, api: ApiResponse): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(api.headers ?? {}),
  };
  let body: Buffer | null = null;
  if (api.bytes !== undefined) {
    body = api.bytes;
  } else if (api.text !== undefined) {
    body = Buffer.from(api.text, 'utf8');
  } else if (api.json !== undefined) {
    body = Buffer.from(JSON.stringify(api.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  if (body !== null && headers['Content-Length'] === undefined) {
    headers['Content-Length'] = String(body.length);
  }
  response.writeHead(api.status, headers);
  if (body !== null && api.status !== 304) {
    response.end(body);
  } else {
    response.end();
  }
}

export function errorResponse(failure: ApiError): ApiResponse {
  return { status: failure.status, json: failure.body(), headers: failure.extraHeaders };
}
