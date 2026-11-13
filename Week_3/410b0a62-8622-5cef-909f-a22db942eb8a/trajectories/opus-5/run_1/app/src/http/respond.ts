import type { ServerResponse } from 'node:http';
import { ApiError, ValidationError } from './errors.js';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
  });
  res.end(html);
}

export function sendRedirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { location, ...headers });
  res.end();
}

/** Every API error leaves through here: {"errors":{…}} or {"error","message"}. */
export function sendApiFailure(res: ServerResponse, error: unknown): void {
  if (error instanceof ValidationError) {
    sendJson(res, 422, { errors: error.fields });
    return;
  }
  if (error instanceof ApiError) {
    sendJson(res, error.status, { error: error.code, message: error.message });
    return;
  }
  sendJson(res, 500, { error: 'server_error', message: 'Something went wrong.' });
}
