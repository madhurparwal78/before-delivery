import type { Response } from 'express';

/** The one shape every API error takes. */
export interface ApiError {
  code: string;
  message: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function sendError(res: Response, err: unknown): void {
  if (err instanceof HttpError) {
    const body: Record<string, unknown> = {
      error: { code: err.code, message: err.message },
    };
    if (err.fields) body.fields = err.fields;
    if (err.extra) Object.assign(body, err.extra);
    res.status(err.status).json(body);
    return;
  }
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side. Your register has not changed.' },
  });
}

export function notFound(message = "This record isn't on your register."): HttpError {
  return new HttpError(404, 'not_found', message);
}

export function forbidden(message = 'Your role may not do this.'): HttpError {
  return new HttpError(403, 'forbidden', message);
}

export function unauthenticated(): HttpError {
  return new HttpError(401, 'unauthenticated', 'Sign in to see your register.');
}

export function conflict(code: string, message: string, extra?: Record<string, unknown>): HttpError {
  return new HttpError(409, code, message, undefined, extra);
}

export function validation(fields: Record<string, string>, message = 'Some fields need attention.'): HttpError {
  return new HttpError(422, 'validation', message, fields);
}

export function outage(code: string, message: string, extra?: Record<string, unknown>): HttpError {
  return new HttpError(503, code, message, undefined, extra);
}
