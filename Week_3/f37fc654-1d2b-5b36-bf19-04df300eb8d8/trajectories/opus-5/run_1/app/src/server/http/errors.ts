import type { Response } from 'express';
import { OUTAGE_BANNERS, type ServiceName } from '../../shared/copy.js';

/** The one error shape the API answers with. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(`${code}`);
  }
}

export class ValidationError extends Error {
  constructor(readonly errors: Record<string, string>) {
    super('validation failed');
  }
}

export const notFound = (): ApiError => new ApiError(404, 'not_found');
export const forbidden = (): ApiError => new ApiError(403, 'forbidden');
export const unauthenticated = (): ApiError => new ApiError(401, 'unauthenticated');
export const sessionExpired = (): ApiError => new ApiError(401, 'session_expired');
export const bodyTooLarge = (): ApiError => new ApiError(413, 'body_too_large');
export const illegalState = (): ApiError => new ApiError(409, 'illegal_state');

/** A 503 carrying the service's published banner text. */
export function serviceDown(service: ServiceName, code: string): ApiError {
  return new ApiError(503, code, OUTAGE_BANNERS[service]);
}

export function sendApiError(res: Response, error: unknown): void {
  if (error instanceof ValidationError) {
    res.status(422).json({ errors: error.errors });
    return;
  }
  if (error instanceof ApiError) {
    const body: Record<string, unknown> = { code: error.code };
    if (error.publicMessage !== undefined) body['message'] = error.publicMessage;
    res.status(error.status).json({ error: { ...body, ...(error.extra ?? {}) } });
    return;
  }
  res.status(500).json({ error: { code: 'internal_error' } });
}
