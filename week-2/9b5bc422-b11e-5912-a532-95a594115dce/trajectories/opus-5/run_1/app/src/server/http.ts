import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BYTE_LIMIT, SESSION_COOKIE } from './config.ts';
import { ApiError, apiError } from './errors.ts';

export type Request = {
  raw: IncomingMessage;
  method: string;
  path: string;
  searchParams: URLSearchParams;
  origin: string;
};

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

export function sendEmpty(response: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  response.end();
}

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    if (error.status === 413) response.setHeader('Connection', 'close');
    sendJson(response, error.status, error.body);
    return;
  }
  sendJson(response, 503, apiError.unavailable().body);
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function readBody(request: IncomingMessage, limit: number, tooLarge: ApiError): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      request.pause();
      throw tooLarge;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(request, JSON_BYTE_LIMIT, apiError.tooLarge());
  if (!body.length) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Same-origin only: a state-changing call from elsewhere is refused. */
export function checkOrigin(request: IncomingMessage): void {
  if (!STATE_CHANGING.has(request.method ?? 'GET')) return;
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  try {
    if (new URL(origin).host !== host) throw apiError.crossOrigin();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw apiError.crossOrigin();
  }
}

export function requestOrigin(request: IncomingMessage): string {
  const forwardedProto = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0];
  const protocol = forwardedProto || 'http';
  return `${protocol}://${request.headers.host}`;
}
