import type { ServerResponse } from 'node:http';
import { ApiError } from '../errors';
import { SESSION_COOKIE, SESSION_DAYS } from './context';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { 'cache-control': 'no-store' });
  res.end();
}

export function sendApiError(res: ServerResponse, error: ApiError): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (error.retryAfterSeconds !== null) headers['retry-after'] = String(error.retryAfterSeconds);
  const payload = Buffer.from(JSON.stringify(error.body), 'utf8');
  headers['content-length'] = String(payload.length);
  res.writeHead(error.status, headers);
  res.end(payload);
}

export function setSessionCookie(res: ServerResponse, token: string): void {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
