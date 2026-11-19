import type { ServerResponse } from 'node:http';
import { ApiError } from '../errors.ts';

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.byteLength,
    ...headers,
  });
  response.end(payload);
}

export function sendEmpty(response: ServerResponse, status: number, headers: Record<string, string> = {}): void {
  response.writeHead(status, headers);
  response.end();
}

export function sendBytes(
  response: ServerResponse,
  status: number,
  body: Buffer,
  headers: Record<string, string>,
): void {
  response.writeHead(status, { ...headers, 'content-length': body.byteLength });
  response.end(body);
}

export function sendError(response: ServerResponse, error: unknown, extraHeaders: Record<string, string> = {}): void {
  if (error instanceof ApiError) {
    sendJson(response, error.status, error.body(), { ...extraHeaders, ...error.headers });
    return;
  }
  sendJson(response, 500, { error: 'internal', message: 'Something went wrong on the server.' }, extraHeaders);
}
