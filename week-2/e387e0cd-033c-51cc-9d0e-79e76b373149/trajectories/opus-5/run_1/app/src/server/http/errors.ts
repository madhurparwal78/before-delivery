import { ERROR_COPY, rateLimitedCopy } from '../../shared/copy';

/** Every error leaves the server in the one published shape. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly copy: string,
    readonly fields: Readonly<Record<string, string>> = {},
    readonly extraHeaders: Readonly<Record<string, string>> = {},
  ) {
    super(copy);
  }

  body(): { error: { code: string; message: string; fields: Record<string, string> } } {
    return { error: { code: this.code, message: this.copy, fields: { ...this.fields } } };
  }
}

type StandardCode = keyof typeof ERROR_COPY;

const STATUSES: Readonly<Record<StandardCode, number>> = {
  unauthenticated: 401,
  session_ended: 401,
  access_removed: 401,
  bad_partner_key: 401,
  bad_signature: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  too_large: 413,
  unsupported_media_type: 415,
  bad_json: 400,
  invalid: 422,
  storage_unreachable: 503,
  invoicing_unreachable: 503,
  sign_in_failed: 401,
  listing_withdrawn: 410,
  request_page_ended: 410,
  original_erased: 410,
  counterparty_blocked: 409,
  release_not_allowed: 409,
  case_closed: 409,
  reason_not_needed: 409,
  ownership_not_pending: 409,
  request_page_not_open: 409,
  claim_not_held: 409,
  lei_taken: 409,
  name_taken: 409,
  address_taken: 409,
  email_taken: 409,
  own_membership: 409,
  message_id_reused: 409,
  answer_not_expected: 409,
  already_answered: 409,
  file_too_large: 413,
  unsupported_file: 415,
  bad_form: 400,
  request_key_reused: 409,
  case_not_closed: 409,
  case_not_archived: 409,
  key_revoked: 409,
};

export function failure(code: StandardCode, fields: Readonly<Record<string, string>> = {}): ApiError {
  return new ApiError(STATUSES[code], code, ERROR_COPY[code], fields);
}

export function invalidFields(fields: Readonly<Record<string, string>>): ApiError {
  return new ApiError(422, 'invalid', ERROR_COPY.invalid, fields);
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, 'rate_limited', rateLimitedCopy(retryAfterSeconds), {}, {
    'Retry-After': String(retryAfterSeconds),
  });
}

export function methodNotAllowed(allow: readonly string[]): ApiError {
  return new ApiError(405, 'method_not_allowed', ERROR_COPY.method_not_allowed, {}, {
    Allow: allow.join(', '),
  });
}
