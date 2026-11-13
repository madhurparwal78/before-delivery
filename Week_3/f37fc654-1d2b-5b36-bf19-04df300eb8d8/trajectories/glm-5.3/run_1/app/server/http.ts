import express, { type Request, type Response, type NextFunction } from 'express';

export interface ApiErrorBody {
  error: { code: string; message?: string; [k: string]: unknown };
}

export class HttpError extends Error {
  public status: number;
  public code: string;
  public extra: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function sendError(res: Response, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    // Validation failures use the plain errors shape.
    const errors = err.extra?.['errors'];
    if (err.status === 422 && typeof errors === 'object' && errors !== null) {
      res.status(422).json({ errors });
      return;
    }
    const body: ApiErrorBody['error'] = { code: err.code, message: err.message, ...err.extra };
    res.status(err.status).json({ error: body });
    return;
  }
  const anyErr = err as { status?: number; code?: string; message?: string };
  if (typeof anyErr.status === 'number' && typeof anyErr.code === 'string') {
    const extra = (anyErr as unknown as { extra?: Record<string, unknown> }).extra;
    res.status(anyErr.status).json({ error: { code: anyErr.code, message: anyErr.message ?? '', ...(extra ?? {}) } });
    return;
  }
  console.error('unhandled error', err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong.' } });
}

export function notFound(res: Response): void {
  res.status(404).json({ error: { code: 'not_found' } });
}

export const JSON_BODY_LIMIT = 65_536;
export const CALLBACK_BODY_LIMIT = 16_777_216;
