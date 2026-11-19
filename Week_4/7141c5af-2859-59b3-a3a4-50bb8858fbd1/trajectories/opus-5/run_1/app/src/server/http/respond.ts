/**
 * Writing a response, including the session cookie's published attributes.
 */
import type { ServerResponse } from 'node:http';
import { ApiError } from './errors.ts';

export const SESSION_COOKIE = 'semenza_session';

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body ?? null);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(text);
}

export function sendNoContent(response: ServerResponse, headers: Record<string, string> = {}): void {
  response.writeHead(204, { 'cache-control': 'no-store', ...headers });
  response.end();
}

export function sendHtml(
  response: ServerResponse,
  status: number,
  html: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(html);
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  bytes: Uint8Array,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': bytes.length,
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(Buffer.from(bytes));
}

export function sendText(
  response: ServerResponse,
  status: number,
  text: string,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(text);
}

export function redirect(response: ServerResponse, to: string): void {
  response.writeHead(302, { location: to, 'cache-control': 'no-store' });
  response.end();
}

export function sendApiError(response: ServerResponse, error: ApiError): void {
  const headers: Record<string, string> = {};
  if (error.retryAfter !== undefined) headers['retry-after'] = String(error.retryAfter);
  if (error.allow !== undefined) headers.allow = error.allow;
  sendJson(response, error.status, error.body, headers);
}

/**
 * HttpOnly, SameSite=Lax, never Secure, and a browser-session cookie with no
 * Max-Age or Expires.
 */
export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
