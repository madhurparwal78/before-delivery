// One error shape and one precedence order for the whole API.
import type { Response } from 'express';

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
              readonly fields?: Record<string, string>) {
    super(message);
  }

  body(): ApiErrorBody {
    const body: ApiErrorBody = { error: { code: this.code, message: this.message } };
    if (this.fields) body.error.fields = this.fields;
    return body;
  }
}

export const unauthenticated = (): ApiError => new ApiError(401, 'UNAUTHENTICATED', 'Sign in first.');
export const notFound = (message = 'Not found.'): ApiError => new ApiError(404, 'NOT_FOUND', message);
export const forbiddenOrigin = (): ApiError => new ApiError(403, 'FORBIDDEN_ORIGIN', 'Forbidden origin.');
export const unsupportedMediaType = (): ApiError => new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON.');
export const payloadTooLarge = (): ApiError => new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Body too large.');
export const idempotencyKeyRequired = (): ApiError => new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header.');
export const idempotencyKeyReused = (): ApiError => new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used with a different body.');
export const validationFailed = (fields: Record<string, string>): ApiError =>
  new ApiError(422, 'VALIDATION_FAILED', 'Some fields need attention.', fields);
export const insufficientCoins = (shortfall: number): ApiError =>
  new ApiError(402, 'INSUFFICIENT_COINS', `You need ${shortfall} more coins.`);
export const layoutLocked = (): ApiError => new ApiError(403, 'LAYOUT_LOCKED', 'This map is locked.');
export const leagueLocked = (): ApiError => new ApiError(403, 'LEAGUE_LOCKED', 'This league is locked.');
export const replayStorageUnavailable = (): ApiError => new ApiError(503, 'REPLAY_STORAGE_UNAVAILABLE', 'Replay storage is unavailable.');
export const mailUnavailable = (): ApiError => new ApiError(503, 'MAIL_UNAVAILABLE', 'We could not send the email right now.');
export const linkExpired = (): ApiError => new ApiError(410, 'LINK_EXPIRED', 'This sign-in link has expired or was already used.');

export function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json(err.body());
}
