import type { ServerResponse } from 'node:http';
import { ApiError } from './errors';

export function sendJson(res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    sendJson(res, error.status, error.body, error.status === 401 ? {} : {});
    return;
  }
  console.error('Unexpected server error', error);
  sendJson(res, 500, { error: 'internal_error', message: 'Something went wrong on our side.' });
}
