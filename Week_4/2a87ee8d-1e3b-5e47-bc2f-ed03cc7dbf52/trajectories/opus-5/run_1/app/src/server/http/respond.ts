import { AppError } from '../errors.js';
import type { RequestContext } from './context.js';

function baseHeaders(
  context: RequestContext,
  extra: Readonly<Record<string, string>>,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...extra,
  };
  const cookies = context.pendingCookies();
  if (cookies.length > 0) headers['Set-Cookie'] = [...cookies];
  return headers;
}

export function sendJson(
  context: RequestContext,
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  context.res.writeHead(
    status,
    baseHeaders(context, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(payload.length),
      'Cache-Control': 'no-store',
      ...extraHeaders,
    }),
  );
  context.res.end(context.method === 'HEAD' ? undefined : payload);
}

export function sendEmpty(
  context: RequestContext,
  status: number,
  extraHeaders: Readonly<Record<string, string>> = {},
): void {
  context.res.writeHead(status, baseHeaders(context, { 'Cache-Control': 'no-store', ...extraHeaders }));
  context.res.end();
}

export function sendBytes(
  context: RequestContext,
  status: number,
  body: Buffer,
  contentType: string,
  extraHeaders: Record<string, string> = {},
): void {
  context.res.writeHead(
    status,
    baseHeaders(context, {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      ...extraHeaders,
    }),
  );
  context.res.end(context.method === 'HEAD' ? undefined : body);
}

export function sendError(context: RequestContext, error: AppError): void {
  const headers: Record<string, string> = { ...error.headers };
  if (error.status === 429 && headers['Retry-After'] === undefined) {
    headers['Retry-After'] = headers['RateLimit-Reset'] ?? '1';
  }
  sendJson(context, error.status, error.body(), headers);
}

export function sendUnhandled(context: RequestContext, error: unknown): void {
  process.stderr.write(`Unhandled request failure: ${(error as Error)?.stack ?? String(error)}\n`);
  // A 5xx is never stored for replay, so a later retry with the same operation id runs again.
  sendJson(context, 500, { error: { code: 'internal', message: 'Something went wrong' } });
}
