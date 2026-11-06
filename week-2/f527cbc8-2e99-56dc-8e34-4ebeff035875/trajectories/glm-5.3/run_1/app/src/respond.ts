import type { ServerResponse, IncomingMessage } from 'node:http';
import type { Caller } from './context.js';
import { AppError } from './errors.js';

export function send(res: ServerResponse, requestId: string, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...extraHeaders
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

export function send204(res: ServerResponse, requestId: string): void {
  res.writeHead(204, { 'X-Request-Id': requestId, 'Content-Length': '0' });
  res.end();
}

export function sendHtml(res: ServerResponse, requestId: string, html: string, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Request-Id': requestId,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  });
  res.end(html);
}

export function requireJson(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError(400, 'bad_request');
  }
  return body as Record<string, unknown>;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export function numField(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
