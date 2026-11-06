import type { Response } from 'express';

export function validationError(status: number, code: string, message: string, fields?: Record<string, string>): { status: number; body: Record<string, unknown> } {
  const body: Record<string, unknown> = { error: code, message };
  if (fields) body.fields = fields;
  return { status, body };
}

export type ApiResult = { status: number; body: Record<string, unknown> };

export function ok(body: Record<string, unknown>): ApiResult {
  return { status: 200, body };
}

export function created(body: Record<string, unknown>): ApiResult {
  return { status: 201, body };
}

export function storeUnavailable(): ApiResult {
  return {
    status: 503,
    body: { error: 'store_unavailable', message: "The shop can't update right now. Try again in a moment." },
  };
}

export interface StoredError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  extras?: Record<string, unknown>;
}

export function storedError(status: number, code: string, message: string, extras?: Record<string, unknown>): StoredError {
  const err = new Error(message) as StoredError;
  err.status = status;
  err.code = code;
  if (extras && Object.keys(extras).length > 0) err.extras = extras;
  return err;
}

export function sendStoredError(res: Response, err: StoredError): void {
  const body: Record<string, unknown> = { error: err.code, message: err.message };
  if (err.fields) body.fields = err.fields;
  if (err.extras) for (const [k, v] of Object.entries(err.extras)) body[k] = v;
  res.status(err.status).json(body);
}
