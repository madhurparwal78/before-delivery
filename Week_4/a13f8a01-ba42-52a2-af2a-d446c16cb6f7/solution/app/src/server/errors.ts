import type { ErrorBody, ErrorCode } from "../shared/types.js";

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
  internal_error: 500,
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(code: ErrorCode, message: string, extra: { fields?: Record<string, string>; head?: number } = {}) {
    super(message);
    this.status = STATUS[code];
    this.body = { error: code, message, ...extra };
  }
}

const NOT_FOUND_MESSAGE = "Nothing here.";

export function notFound(): ApiError {
  return new ApiError("not_found", NOT_FOUND_MESSAGE);
}

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError("validation", Object.values(fields)[0] ?? "The request is not valid.", { fields });
}

export class StorageUnavailable extends Error {
  constructor(cause?: unknown) {
    super("Storage is unreachable.", { cause });
  }
}

export class MailUnavailable extends Error {
  constructor(cause?: unknown) {
    super("Mail is unreachable.", { cause });
  }
}
