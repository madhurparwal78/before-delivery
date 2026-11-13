import { IncomingMessage, ServerResponse } from 'node:http';

// One error shape for the whole API.
export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  retryAfter?: number;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

export const messages = {
  crossOrigin: 'This request came from another site.',
  unauthenticated: 'Sign in to continue.',
  malformedBody: 'The request body could not be read.',
  idempotencyConflict: 'This Idempotency-Key was already used with a different request.',
  idempotencyInProgress: 'An earlier request with this Idempotency-Key is still running.',
  idempotencyKeyRequired: 'An Idempotency-Key header is required.',
  reauth: 'Confirm your password to continue.',
  rateLimited: 'Too many claims in the last minute. Try again shortly.',
  tooManyAttempts: 'Too many sign-in attempts for that email. Try again in a few minutes.',
  payloadTooLarge: 'The request body is too large.',
  unsupportedMedia: 'The request body type is not supported.',
  storageUnavailable: 'Document storage is unreachable.',
  storageReadUnavailable: 'Previews are unavailable while document storage is unreachable.',
  billingUnavailablePurchase: 'Billing is unreachable. Nothing was charged.',
  billingUnavailableRefund: 'Billing is unreachable. No refund was issued.',
  internal: 'Something went wrong on our side.',
  notFound: "That record isn't available.",
  forbidden: 'This action is not available for your account.',
} as const;

export function errUnauthenticated(): ApiError { return new ApiError(401, 'unauthenticated', messages.unauthenticated); }
export function errForbidden(): ApiError { return new ApiError(403, 'forbidden', messages.forbidden); }
export function errNotFound(): ApiError { return new ApiError(404, 'not_found', messages.notFound); }
export function errValidation(fields: Record<string, string>): ApiError {
  const first = Object.values(fields)[0] ?? 'Validation failed.';
  return new ApiError(422, 'validation_failed', first, fields);
}
export function errConflict(code: string, message: string): ApiError { return new ApiError(409, code, message); }
export function errInternal(): ApiError { return new ApiError(500, 'internal_error', messages.internal); }

export interface Body {
  json: unknown;
  raw?: Uint8Array;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  body: unknown;
  rawBody?: Uint8Array;
  cookieToken: string | null;
  role: 'owner' | 'shift_lead' | 'tenant' | null;
  userId: string | null;
  tenantId: string | null;
  confirmedAt: number | null;
  params: Record<string, string>;
  idempotencyKey: string | null;
}
