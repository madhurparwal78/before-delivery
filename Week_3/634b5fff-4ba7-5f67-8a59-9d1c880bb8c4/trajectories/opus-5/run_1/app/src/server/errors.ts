import type { Response } from 'express';
import { errorCopy, outageCopy, type OutageSurface } from '../shared/copy.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

type PlainCode = {
  [K in keyof typeof errorCopy]: (typeof errorCopy)[K] extends string ? K : never;
}[keyof typeof errorCopy];

export function fail(status: number, code: PlainCode): ApiError {
  return new ApiError(status, code, errorCopy[code] as string);
}

export function failForBox(
  status: number,
  code: 'hold_ended' | 'box_held' | 'box_taken' | 'lapsed' | 'capture_refused',
  boxNumber: number,
  extra?: Record<string, unknown>,
): ApiError {
  return new ApiError(status, code, errorCopy[code](boxNumber), undefined, extra);
}

export function failValidation(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation_failed', errorCopy.validation_failed, fields);
}

export function failOutage(
  code: 'gateway_unreachable' | 'ledger_unreachable',
  surface: OutageSurface,
  extra?: Record<string, unknown>,
): ApiError {
  return new ApiError(503, code, outageCopy[surface][code], undefined, extra);
}

export function failStorage(direction: 'upload' | 'download'): ApiError {
  return new ApiError(
    503,
    'storage_unreachable',
    direction === 'upload' ? outageCopy.uploadStorage : outageCopy.downloadStorage,
  );
}

export function sendError(res: Response, error: ApiError): void {
  if (error.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(error.retryAfterSeconds));
  }
  const body: Record<string, unknown> = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    },
    ...(error.extra ?? {}),
  };
  res.status(error.status).json(body);
}
