import { Reason } from '../shared/types';

export type FieldCode = 'required' | 'invalid' | 'too_long' | 'out_of_range' | string;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? 'error'));
  }
}

export function validation(fields: Record<string, FieldCode>): ApiError {
  return new ApiError(422, { error: 'validation', fields });
}

export function restricted(reason: Reason): ApiError {
  const payload: Record<string, unknown> = { code: reason.code };
  if (reason.date !== undefined) payload.date = reason.date;
  if (reason.n !== undefined) payload.n = reason.n;
  return new ApiError(422, { error: 'restricted', reason: payload });
}

export function notFound(): ApiError {
  return new ApiError(404, { error: 'not_found' });
}

export function forbidden(): ApiError {
  return new ApiError(403, { error: 'forbidden' });
}

export function unauthorized(code = 'unauthorized'): ApiError {
  return new ApiError(401, { error: code });
}

export function conflict(error: string, extra: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, { error, ...extra });
}

export function gone(error: string): ApiError {
  return new ApiError(410, { error });
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, { error: 'storage_unavailable' });
}
