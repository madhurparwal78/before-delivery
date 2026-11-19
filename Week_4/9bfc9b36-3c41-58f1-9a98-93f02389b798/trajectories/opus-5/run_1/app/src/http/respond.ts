import type { ServerResponse } from 'node:http';
import { AppError } from './errors';
import { ERROR_COPY } from '../shared/copy';

/**
 * Every response leaves through here, so the header set is decided in one place:
 * private no-store caching, no framework header, no method list, no cross-origin
 * allowance, and one byte-identical not-found body at every address.
 */

export const NOT_FOUND_BODY = Buffer.from(
  JSON.stringify({ error: 'not_found', message: ERROR_COPY.not_found }),
  'utf8',
);

const NO_STORE = 'private, no-store';

export function send(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: Buffer,
  extra: Readonly<Record<string, string>> = {},
): void {
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-length': String(body.length),
    'cache-control': NO_STORE,
    ...extra,
  };
  response.writeHead(status, headers);
  response.end(body);
}

export function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  extra: Readonly<Record<string, string>> = {},
): void {
  send(response, status, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(value), 'utf8'), extra);
}

/** The one not-found answer: identical body and identical header set everywhere. */
export function sendNotFound(response: ServerResponse): void {
  response.writeHead(404, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(NOT_FOUND_BODY.length),
    'cache-control': NO_STORE,
  });
  response.end(NOT_FOUND_BODY);
}

export function sendRefusal(response: ServerResponse, refusal: AppError): void {
  if (refusal.status === 404) {
    sendNotFound(response);
    return;
  }
  sendJson(response, refusal.status, refusal.body(), refusal.headers ?? {});
}

export function sendNoContent(response: ServerResponse, extra: Readonly<Record<string, string>> = {}): void {
  response.writeHead(204, { 'cache-control': NO_STORE, ...extra });
  response.end();
}
