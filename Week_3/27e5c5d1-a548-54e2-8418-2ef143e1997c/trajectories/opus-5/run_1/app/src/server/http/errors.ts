import type { CardPayload, CardStatus } from '../../shared/types';

export type ErrorCode =
  | 'signed_out'
  | 'invalid_credentials'
  | 'forbidden'
  | 'cross_origin'
  | 'not_found'
  | 'method_not_allowed'
  | 'stale'
  | 'invalid_transition'
  | 'archived'
  | 'last_admin'
  | 'already_member'
  | 'no_change'
  | 'email_taken'
  | 'idempotency_conflict'
  | 'too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'internal'
  | 'storage_unavailable';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: ErrorCode,
    extra: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }

  body(): Record<string, unknown> {
    return { error: this.code, ...this.extra };
  }
}

export const errors = {
  signedOut: () => new ApiError(401, 'signed_out'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials'),
  forbidden: () => new ApiError(403, 'forbidden'),
  crossOrigin: () => new ApiError(403, 'cross_origin'),
  notFound: () => new ApiError(404, 'not_found'),
  methodNotAllowed: (allow: string[]) => new ApiError(405, 'method_not_allowed', {}, { Allow: allow.join(', ') }),
  stale: (card: CardPayload, changedBy: string, change: 'moved' | 'edited') =>
    new ApiError(409, 'stale', { card, changedBy: { displayName: changedBy }, change }),
  invalidTransition: (from: CardStatus, to: CardStatus) => new ApiError(409, 'invalid_transition', { from, to }),
  archived: () => new ApiError(409, 'archived'),
  lastAdmin: () => new ApiError(409, 'last_admin'),
  alreadyMember: () => new ApiError(409, 'already_member'),
  noChange: () => new ApiError(409, 'no_change'),
  emailTaken: () => new ApiError(409, 'email_taken'),
  idempotencyConflict: () => new ApiError(409, 'idempotency_conflict'),
  tooLarge: () => new ApiError(413, 'too_large'),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type'),
  validation: (fields: Record<string, string>) => new ApiError(422, 'validation', { fields }),
  internal: () => new ApiError(500, 'internal'),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable'),
};
