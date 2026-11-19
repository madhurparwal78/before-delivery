import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DesignerRecord } from './store.js';

export const MAX_BODY_BYTES = 65536;
export const SESSION_COOKIE = 'mullion_session';

export interface RequestContext {
  method: string;
  url: URL;
  path: string;
  segments: string[];
  body: Record<string, unknown>;
  bodyInvalid: boolean;
  session: DesignerRecord | null;
  sessionToken: string | null;
  headers: IncomingMessage['headers'];
}

export type BodyRead = { ok: true; body: Record<string, unknown>; invalid: boolean } | { ok: false };

export async function readBody(request: IncomingMessage): Promise<BodyRead> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return { ok: false };
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim().length === 0) return { ok: true, body: {}, invalid: false };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: true, body: {}, invalid: true };
    }
    return { ok: true, body: parsed as Record<string, unknown>, invalid: false };
  } catch {
    return { ok: true, body: {}, invalid: true };
  }
}

export function readCookie(request: IncomingMessage, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  cookie?: string,
): void {
  const text = body === undefined ? '' : JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  };
  if (cookie) headers['set-cookie'] = cookie;
  response.writeHead(status, headers);
  response.end(text);
}

export function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(Buffer.byteLength(html)),
    'cache-control': 'no-store',
  });
  response.end(html);
}

export function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, 'content-length': '0', 'cache-control': 'no-store' });
  response.end();
}
