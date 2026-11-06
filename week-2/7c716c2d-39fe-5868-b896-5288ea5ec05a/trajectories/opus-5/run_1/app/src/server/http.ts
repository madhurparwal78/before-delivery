import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';

export const JSON_BODY_LIMIT = 1_000_000;
export const ATTACHMENT_LIMIT = 10_000_000;
export const UPLOAD_BODY_LIMIT = ATTACHMENT_LIMIT + 1_000_000;

export type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  cookie?: { value: string; maxAge: number } | { clear: true };
};

export const HANDLED: unique symbol = Symbol('handled');

export type Handled = typeof HANDLED;

export function cookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    out[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      request.pause();
      throw new ApiError('too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(buffer: Buffer): Record<string, unknown> {
  if (buffer.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new ApiError('validation', { message: 'Send a JSON object.' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError('validation', { message: 'Send a JSON object.' });
  }
  return parsed as Record<string, unknown>;
}

export function isJsonContentType(request: IncomingMessage): boolean {
  const header = request.headers['content-type'];
  if (header === undefined) return false;
  return header.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export function isMultipartContentType(request: IncomingMessage): boolean {
  const header = request.headers['content-type'];
  if (header === undefined) return false;
  return header.split(';')[0]?.trim().toLowerCase() === 'multipart/form-data';
}

export function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer | undefined;
  if (reply.body !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(payload.length);
  }
  if (reply.cookie !== undefined) {
    headers['Set-Cookie'] =
      'clear' in reply.cookie
        ? 'tr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
        : `tr_session=${reply.cookie.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${reply.cookie.maxAge}`;
  }
  headers['Cache-Control'] = headers['Cache-Control'] ?? 'no-store';
  response.writeHead(reply.status, headers);
  if (payload === undefined) response.end();
  else response.end(payload);
}
