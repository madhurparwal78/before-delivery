import type { ErrorBody, ErrorCode } from "../shared/types";

const statusByCode: Record<ErrorCode, number> = {
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

const defaultMessages: Record<ErrorCode, string> = {
  body_too_large: "The request body is too large.",
  not_signed_in: "Sign in to do this.",
  bad_credentials: "That email or password is not right.",
  not_found: "Nothing here.",
  forbidden: "You cannot change this.",
  unverified: "Verify your email to do this.",
  version_conflict: "A newer version of this pen was saved somewhere else.",
  idempotency_conflict: "That Idempotency-Key was already used with a different request.",
  duplicate: "That already exists.",
  already_verified: "This account is already verified.",
  nothing_to_fork: "Save a version before forking.",
  nothing_to_export: "Save a version before exporting.",
  validation: "Some of the details are not valid.",
  token_invalid: "This link is not valid. It may have been used already.",
  token_expired: "This link has expired.",
  storage_unavailable: "Storage is unreachable.",
  mail_unavailable: "Mail is unreachable.",
};

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(code: ErrorCode, extra: { message?: string; fields?: Record<string, string>; head?: number } = {}) {
    const body: ErrorBody = { error: code, message: code === "not_found" ? defaultMessages.not_found : (extra.message ?? defaultMessages[code]) };
    if (extra.fields) body.fields = extra.fields;
    if (extra.head !== undefined) body.head = extra.head;
    super(body.message);
    this.status = statusByCode[code];
    this.body = body;
  }
}

export function notFound(): ApiError {
  return new ApiError("not_found");
}

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError("validation", { fields });
}

export class StorageUnavailable extends Error {}
export class MailUnavailable extends Error {}
