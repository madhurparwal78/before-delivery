import type { ServerResponse } from 'node:http';
import { ApiError } from '../errors.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204, { 'cache-control': 'no-store' });
  res.end();
}

/** The one place an error reaches the wire. */
export function sendError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof ApiError) {
    sendJson(res, error.status, error.body());
    return;
  }
  process.stderr.write(`unhandled request failure: ${String(error)}\n`);
  sendJson(res, 500, { error: 'internal_error' });
}
