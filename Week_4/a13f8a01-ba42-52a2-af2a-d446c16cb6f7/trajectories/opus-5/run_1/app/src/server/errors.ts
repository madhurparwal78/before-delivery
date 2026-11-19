import type { ApiErrorBody, ErrorCode } from '../shared/api';

const STATUS: Record<ErrorCode, number> = {
  body_too_large: 413,
  not_signed_in: 401,
  bad_credentials: 401,
  not_found: 404,
  forbidden: 403,
  unverified: 403,
  version_conflict: 409,
  idempotency_conflict: 409,
  duplicate: 409,
  already_verified: 409,
  nothing_to_fork: 409,
  nothing_to_export: 409,
  validation: 422,
  token_invalid: 422,
  token_expired: 422,
  storage_unavailable: 503,
  mail_unavailable: 503,
};

/** The single precedence order for the whole API: the first failing check decides. */
const PRECEDENCE: ErrorCode[] = [
  'body_too_large',
  'not_signed_in',
  'bad_credentials',
  'not_found',
  'forbidden',
  'unverified',
  'version_conflict',
  'idempotency_conflict',
  'duplicate',
  'already_verified',
  'nothing_to_fork',
  'nothing_to_export',
  'validation',
  'token_invalid',
  'token_expired',
  'storage_unavailable',
  'mail_unavailable',
];

const MESSAGE: Record<ErrorCode, string> = {
  body_too_large: 'The request body is too large.',
  not_signed_in: 'Sign in to do this.',
  bad_credentials: 'That email or password is not right.',
  not_found: 'Nothing here.',
  forbidden: 'You may not change this.',
  unverified: 'Verify your email to do this.',
  version_conflict: 'This pen was saved somewhere else.',
  idempotency_conflict: 'That idempotency key was used with a different body.',
  duplicate: 'That already exists.',
  already_verified: 'This account is already verified.',
  nothing_to_fork: 'Save a version before forking this pen.',
  nothing_to_export: 'Save a version before exporting.',
  validation: 'Some values are not right.',
  token_invalid: 'This link is not valid.',
  token_expired: 'This link has expired.',
  storage_unavailable: 'Storage is unreachable, so nothing was changed.',
  mail_unavailable: 'Mail is unreachable, so nothing was sent.',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly head?: number;

  constructor(code: ErrorCode, options: { message?: string; fields?: Record<string, string>; head?: number } = {}) {
    super(options.message ?? MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    if (options.fields) this.fields = options.fields;
    if (options.head !== undefined) this.head = options.head;
  }

  get rank(): number {
    return PRECEDENCE.indexOf(this.code);
  }

  get body(): ApiErrorBody {
    const body: ApiErrorBody = { error: this.code, message: this.message };
    if (this.fields) body.fields = this.fields;
    if (this.head !== undefined) body.head = this.head;
    return body;
  }
}

export const apiError = (
  code: ErrorCode,
  options?: { message?: string; fields?: Record<string, string>; head?: number },
): ApiError => new ApiError(code, options);

/** The not-found answer used for missing resources and for anything the caller may not see. */
export const notFound = (): ApiError => new ApiError('not_found');

/**
 * Raises the candidate failure that comes first in the API's precedence order, so that routes
 * can gather several checks without deciding the order themselves.
 */
export const raiseFirst = (...candidates: (ApiError | null)[]): void => {
  let first: ApiError | null = null;
  for (const candidate of candidates) {
    if (candidate && (first === null || candidate.rank < first.rank)) first = candidate;
  }
  if (first) throw first;
};
