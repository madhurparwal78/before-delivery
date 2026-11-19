// Every API error goes through this one shape with the published codes.

import type { ServerResponse } from 'node:http';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const errors = {
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue.'),
  invalidKey: () => new ApiError(401, 'invalid_key', 'This API key is invalid or revoked.'),
  notFound: () => new ApiError(404, 'not_found', 'Not found.'),
  forbidden: () => new ApiError(403, 'forbidden', 'You are not allowed to do this.'),
  crossOrigin: () => new ApiError(403, 'cross_origin', 'Cross-origin writes are refused.'),
  validation: (fields: Record<string, string>) => new ApiError(422, 'validation_failed', 'Validation failed.', fields),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', 'The request body is too large.'),
  unsupportedMedia: () => new ApiError(415, 'unsupported_media_type', 'Send the body as application/json.'),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  tooMany: (code: string, message: string) => new ApiError(429, code, message),
  unavailable: (code: string, message: string) => new ApiError(503, code, message),
  internal: () => new ApiError(500, 'internal', 'Something went wrong. Try again.'),
};

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof ApiError) {
    const body = err.fields
      ? { error: err.code, message: err.message, fields: err.fields }
      : { error: err.code, message: err.message };
    writeJson(res, err.status, body);
  } else {
    writeJson(res, 500, { error: 'internal', message: 'Something went wrong. Try again.' });
  }
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  res.end(data);
}
