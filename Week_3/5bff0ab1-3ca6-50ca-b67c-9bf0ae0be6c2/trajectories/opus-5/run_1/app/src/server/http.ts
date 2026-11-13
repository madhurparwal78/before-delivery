import type { IncomingMessage, ServerResponse } from 'node:http';
import { fail } from './errors.js';

export const MAX_BODY_BYTES = 16_384;

export interface Reply {
  status: number;
  json?: unknown;
  html?: string;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  queryOf(name: string): string | null;
  cookies: Record<string, string>;
  rawBody: Buffer;
  body(): Record<string, unknown>;
  bodyUnchecked(): unknown;
  setCookie(value: string): void;
  responseHeaders: Record<string, string>;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const base = value.split(';')[0]?.trim().toLowerCase();
  return base === 'application/json';
}

export async function readBody(request: IncomingMessage): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared && Number(declared) > MAX_BODY_BYTES) fail('too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) fail('too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function makeContext(options: {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  rawBody: Buffer;
}): RequestContext {
  const cookieHeaders: string[] = [];
  const responseHeaders: Record<string, string> = {};
  let parsed: unknown;
  let parsedDone = false;
  const parse = (): unknown => {
    if (!parsedDone) {
      parsedDone = true;
      if (options.rawBody.length === 0) {
        parsed = {};
      } else {
        try {
          parsed = JSON.parse(options.rawBody.toString('utf8'));
        } catch {
          parsed = undefined;
        }
      }
    }
    return parsed;
  };
  return {
    method: options.method,
    path: options.path,
    params: options.params,
    queryOf: (name) => options.query.get(name),
    cookies: options.cookies,
    rawBody: options.rawBody,
    body(): Record<string, unknown> {
      const value = parse();
      if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail('invalid_body');
      }
      return value as Record<string, unknown>;
    },
    bodyUnchecked: () => parse(),
    setCookie(value: string) {
      cookieHeaders.push(value);
      responseHeaders['Set-Cookie'] = cookieHeaders.join(', ');
    },
    responseHeaders,
  };
}

export function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...reply.headers,
  };
  if (reply.json !== undefined) {
    const text = JSON.stringify(reply.json);
    headers['Content-Type'] = 'application/json; charset=utf-8';
    response.writeHead(reply.status, headers);
    response.end(text);
    return;
  }
  if (reply.html !== undefined) {
    headers['Content-Type'] = 'text/html; charset=utf-8';
    response.writeHead(reply.status, headers);
    response.end(reply.html);
    return;
  }
  if (reply.bytes) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    response.writeHead(reply.status, headers);
    response.end(reply.bytes);
    return;
  }
  response.writeHead(reply.status, headers);
  response.end();
}

