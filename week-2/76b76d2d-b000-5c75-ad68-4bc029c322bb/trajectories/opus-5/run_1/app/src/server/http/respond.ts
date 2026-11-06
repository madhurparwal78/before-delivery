import type { ServerResponse } from 'node:http';
import type { Locale } from '../../shared/money.ts';
import { t } from '../../shared/strings.ts';
import { ApiError } from './errors.ts';

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  options: { maxAge?: number; httpOnly?: boolean } = {},
): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax'];
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`Max-Age=${options.maxAge ?? 60 * 60 * 24 * 365}`);
  const existing = res.getHeader('Set-Cookie');
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

export function sendRedirect(res: ServerResponse, status: number, location: string): void {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store', 'Content-Length': 0 });
  res.end();
}

export function errorBody(error: ApiError, locale: Locale): Record<string, unknown> {
  const args =
    error.code === 'seat_taken'
      ? { ...error.options.args, seats: (error.options.seats ?? []).join(', ') }
      : error.options.args;
  const payload: Record<string, unknown> = {
    code: error.code,
    message: t(`err_${error.code}`, locale, args),
  };
  if (error.code === 'validation' && error.options.fields !== undefined) {
    payload.fields = Object.fromEntries(
      Object.entries(error.options.fields).map(([field, message]) => [field, t(message.key, locale, message.args)]),
    );
  }
  if (error.code === 'seat_taken') payload.seats = error.options.seats ?? [];
  if (error.code === 'code_incorrect') payload.attempts_left = error.options.attemptsLeft ?? 0;
  if (error.status === 429) payload.retry_after_seconds = error.options.retryAfterSeconds ?? 0;
  return { error: payload };
}

export function sendApiError(res: ServerResponse, error: ApiError, locale: Locale): void {
  if (error.status === 429) res.setHeader('Retry-After', String(error.options.retryAfterSeconds ?? 0));
  if (error.code === 'method_not_allowed') res.setHeader('Allow', 'GET');
  sendJson(res, error.status, errorBody(error, locale));
}
