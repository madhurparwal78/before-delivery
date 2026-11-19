// One error shape for the whole API, and the published check order.

import { ServerResponse } from 'node:http';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    conflicts?: unknown[];
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): ErrorBody {
    const error: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields && Object.keys(this.fields).length) error.fields = this.fields;
    if (this.extra) Object.assign(error, this.extra);
    return { error: error as ErrorBody['error'] };
  }
}

export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', 'Sign in to continue.');

export const notFound = (): ApiError =>
  new ApiError(404, 'not_found', 'No such record.');

export const forbidden = (): ApiError =>
  new ApiError(403, 'forbidden', 'Your role cannot do this.');

export const operatorOnly = (): ApiError =>
  new ApiError(403, 'operator_only', 'Only the operator can do this.');

export const denied = (message: string): ApiError =>
  new ApiError(403, 'denied', message);

export const fieldDenied = (label: string): ApiError =>
  new ApiError(403, 'field_denied', `You cannot change ${label}.`);

export const unknownField = (path: string): ApiError =>
  new ApiError(422, 'unknown_field', `Unknown field "${path}".`);

export const rateLimited = (seconds: number): ApiError =>
  new ApiError(429, 'rate_limited', `Too many requests. Try again in ${seconds} seconds.`, undefined, { retry_after: seconds });

export function writeError(res: ServerResponse, err: ApiError): void {
  const body = JSON.stringify(err.body());
  res.writeHead(err.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...(err.code === 'rate_limited' ? { 'Retry-After': String((err.extra?.retry_after as number) ?? 1) } : {}),
  });
  res.end(body);
}
