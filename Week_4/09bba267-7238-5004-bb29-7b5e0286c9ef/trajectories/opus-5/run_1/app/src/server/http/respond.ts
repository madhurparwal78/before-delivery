import type { ServerResponse } from 'node:http';

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body };
}

export function error(status: number, code: string, extra?: Record<string, unknown>): ApiResponse {
  return { status, body: { error: code, ...extra } };
}

export function validationError(fields: Record<string, string>): ApiResponse {
  return { status: 422, body: { error: 'validation', fields } };
}

export function sendJson(res: ServerResponse, response: ApiResponse, cookies: readonly string[] = []): void {
  const payload = response.body === undefined ? '' : JSON.stringify(response.body);
  const headers: Record<string, string | string[]> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (cookies.length > 0) headers['set-cookie'] = [...cookies];
  res.writeHead(response.status, headers);
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  status: number,
  contentType: string,
  payload: string | Buffer,
  extraHeaders: Record<string, string> = {},
  cookies: readonly string[] = [],
): void {
  const headers: Record<string, string | string[]> = {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  };
  if (cookies.length > 0) headers['set-cookie'] = [...cookies];
  res.writeHead(status, headers);
  res.end(payload);
}
