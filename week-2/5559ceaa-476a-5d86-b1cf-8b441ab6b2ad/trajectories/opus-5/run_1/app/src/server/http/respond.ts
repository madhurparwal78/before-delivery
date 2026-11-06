import type { ServerResponse } from 'node:http';
import type { ApiErrorBody } from '../../shared/api.js';
import { ApiError } from './errors.js';

export const REVIEW_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex',
};

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    ...headers,
  });
  res.end(body);
}

export function sendEmpty(
  res: ServerResponse,
  status: number,
  headers: Readonly<Record<string, string>> = {},
): void {
  res.writeHead(status, headers);
  res.end();
}

function errorBody(error: ApiError): ApiErrorBody {
  return { error: { code: error.code, message: error.message, ...error.extra } };
}

export function sendError(
  res: ServerResponse,
  error: ApiError,
  headers: Readonly<Record<string, string>> = {},
): void {
  sendJson(res, error.status, errorBody(error), headers);
}
