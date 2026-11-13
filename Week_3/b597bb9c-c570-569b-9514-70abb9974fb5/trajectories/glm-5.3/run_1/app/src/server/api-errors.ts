import type { Response, Request } from 'express';
import {
  ERROR_STATUS, API_ERROR_TEXT, FIELD_ERROR_TEXT, type ErrorCode, type FieldError,
} from '../shared/errors';

/**
 * The one error shape. Every API error answers
 * {"error":"<code>","message":"<copy>"}, built here from the one copy table.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(code: ErrorCode, params?: Record<string, string | number>, extra?: Record<string, unknown>) {
    super(code);
    this.status = ERROR_STATUS[code];
    this.body = { error: code, message: fill(code, params), ...(extra ?? {}) };
  }

  /** A 422 with per-field copy, one entry per invalid field. */
  static validation(fields: Record<string, { key: FieldError; params?: Record<string, string> }>): ApiError {
    const errors: Record<string, string> = {};
    for (const [field, spec] of Object.entries(fields)) {
      errors[field] = fillField(spec.key, spec.params);
    }
    const err = new ApiError('validation');
    err.body.errors = errors;
    return err;
  }
}

function fill(code: ErrorCode, params?: Record<string, string | number>): string {
  const template = API_ERROR_TEXT[code];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}

export function fillField(key: FieldError, params?: Record<string, string | number>): string {
  const template = FIELD_ERROR_TEXT[key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));
}

export function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json(err.body);
}

export function apiFail(res: Response, code: ErrorCode, params?: Record<string, string | number>, extra?: Record<string, unknown>): void {
  sendError(res, new ApiError(code, params, extra));
}

export function requireJson(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}
