// HTTP response helpers shared by all API modules.

import http from 'node:http';
import { ApiError } from './errors.js';
import { readBody, JSON_BODY_LIMIT } from './boundary.js';
import { validation } from './errors.js';

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

export function sendError(res: http.ServerResponse, e: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (e instanceof ApiError) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (e.code === 'rate_limited') {
      const retryAfter = Number((e.body as Record<string, unknown>).retryAfter ?? 1);
      headers['Retry-After'] = String(retryAfter);
    }
    res.writeHead(e.status, headers);
    res.end(JSON.stringify(e.body));
    return;
  }
  if (process.env.RUSHES_DEBUG) {
    process.stderr.write(`[rushes] 500: ${e instanceof Error ? e.stack : String(e)}\n`);
  }
  res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'internal', message: 'Something went wrong.' }));
}

export async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type'] ?? '';
  const method = (req.method ?? '').toUpperCase();
  if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
    return {};
  }
  if (!contentType.startsWith('application/json')) {
    throw (await import('./errors.js')).unsupportedMediaType();
  }
  const body = await readBody(req, JSON_BODY_LIMIT);
  if (body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw validation({ _: 'Invalid JSON.' });
  }
}

export function setSessionCookie(res: http.ServerResponse, token: string): void {
  res.setHeader('Set-Cookie', `rushes_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/`);
}

export function clearSessionCookie(res: http.ServerResponse): void {
  res.setHeader('Set-Cookie', 'rushes_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}
