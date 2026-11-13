import type { Request, Response, NextFunction } from 'express';
import { errorCopy } from '../shared/copy.js';

/** The one published error shape. */
export interface ApiError extends Error {
  code: string;
  status: number;
  fields?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export function apiError(status: number, code: string, extra?: Record<string, unknown>): ApiError {
  const err = new Error(code) as ApiError;
  err.status = status;
  err.code = code;
  err.extra = extra;
  return err;
}

export function validationError(fields: Record<string, string>): ApiError {
  const err = apiError(422, 'validation_failed') as ApiError & { fields: Record<string, string> };
  err.fields = fields;
  return err;
}

export function errorBody(code: string, fields?: Record<string, string>): { error: { code: string; message: string; fields?: Record<string, string> } } {
  const error: { code: string; message: string; fields?: Record<string, string> } = {
    code,
    message: errorCopy(code),
  };
  if (fields) error.fields = fields;
  return { error };
}

export function sendError(res: Response, err: ApiError): void {
  const body = errorBody(err.code, err.fields);
  const out = { ...body, ...(err.extra ?? {}) } as Record<string, unknown>;
  res.status(err.status ?? 500).json(out);
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json(errorBody('not_found'));
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
