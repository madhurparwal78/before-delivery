import type { ServerResponse } from 'node:http';
import { ApiError } from '../domain/errors.js';

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(payload);
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'content-length': String(body.length),
    ...headers,
  });
  response.end(body);
}

export function sendError(response: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(response, error.status, error.toJson());
    return;
  }
  sendJson(response, 500, {
    error: { code: 'internal', message: 'Something went wrong. Try again.' },
  });
}
