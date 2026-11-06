import type { ServerResponse } from 'node:http';
import { ApiError } from './errors.ts';

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
};

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...headers,
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    date: new Date().toUTCString(),
  });
  response.end(isHead(response) ? undefined : payload);
}

export function sendEmpty(
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers, date: new Date().toUTCString() });
  response.end();
}

export function sendText(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...headers,
    'content-type': contentType,
    'content-length': payload.length,
    date: new Date().toUTCString(),
  });
  response.end(isHead(response) ? undefined : payload);
}

function isHead(response: ServerResponse): boolean {
  return (response.req.method ?? '').toUpperCase() === 'HEAD';
}

export function sendApiError(response: ServerResponse, error: ApiError): void {
  sendJson(response, error.status, error.body, error.headers);
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
