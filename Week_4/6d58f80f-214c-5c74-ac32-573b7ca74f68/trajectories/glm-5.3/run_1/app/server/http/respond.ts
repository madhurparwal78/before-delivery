import type { IncomingMessage, ServerResponse } from 'node:http';
import { STATUS_BY_CODE, type ApiErrorCode } from './errors.js';
import { config } from '../config/runtime.js';

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function sendError(res: ServerResponse, err: ApiError): void {
  const status = STATUS_BY_CODE[err.code] ?? 500;
  const body: Record<string, unknown> = { error: err.code };
  if (err.fields) body.fields = err.fields;
  if (err.extra) Object.assign(body, err.extra);
  sendJson(res, status, body);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export function isOwnOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const own = new URL(config.appUrl);
    return origin === `${own.protocol}//${own.host}` || origin === own.origin;
  } catch {
    return false;
  }
}
