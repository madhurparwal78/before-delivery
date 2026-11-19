import type { Json } from '../types.js';
import type { Response } from 'express';

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: FieldErrors;
  readonly extra?: Record<string, Json>;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { fields?: FieldErrors; extra?: Record<string, Json>; headers?: Record<string, string> },
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options?.fields;
    this.extra = options?.extra;
    this.headers = options?.headers;
  }
}

export function errorBody(code: string, message: string, fields?: FieldErrors, extra?: Record<string, Json>): Json {
  const inner: Record<string, Json> = { code, message };
  if (fields && Object.keys(fields).length > 0) inner.fields = fields;
  if (extra) for (const [key, value] of Object.entries(extra)) inner[key] = value;
  return { error: inner };
}

export function jsonError(res: Response, err: ApiError): void {
  res.status(err.status);
  for (const [key, value] of Object.entries(err.headers ?? {})) res.setHeader(key, value);
  res.json(errorBody(err.code, err.message, err.fields, err.extra));
}

export const INTERNAL_ERROR = new ApiError(500, 'internal', 'Something went wrong.');

export function validationError(fields: FieldErrors): ApiError {
  return new ApiError(422, 'validation', 'The request is not valid.', { fields });
}

export function validationBody(fields: FieldErrors): Json {
  return errorBody('validation', 'The request is not valid.', fields);
}

export function unknownField(name: string): FieldErrors {
  const fields: FieldErrors = {};
  fields[name] = 'Unknown field.';
  return fields;
}
